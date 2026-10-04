import type { GenerateOptions, LLMProvider } from "./provider.js";
import { ProviderError, streamChatCompletions } from "./provider.js";

/**
 * Streaming-safe filter that swallows <think>…</think> reasoning blocks some free
 * models emit inline in `content`. Holds back a tail buffer so a tag split across
 * chunks is still detected. Untagged content passes through unchanged.
 */
export class ThinkFilter {
  private inside = false;
  private tail = "";
  private static OPEN = "<think>";
  private static CLOSE = "</think>";

  push(chunk: string, emit: (s: string) => void): void {
    this.tail += chunk;
    for (;;) {
      if (!this.inside) {
        const open = this.tail.indexOf(ThinkFilter.OPEN);
        if (open === -1) {
          // hold back a possible partial opening tag at the end
          const keep = Math.min(this.tail.length, ThinkFilter.OPEN.length - 1);
          const safe = this.tail.slice(0, this.tail.length - keep);
          if (safe) emit(safe);
          this.tail = this.tail.slice(this.tail.length - keep);
          return;
        }
        if (open > 0) emit(this.tail.slice(0, open));
        this.tail = this.tail.slice(open + ThinkFilter.OPEN.length);
        this.inside = true;
      } else {
        const close = this.tail.indexOf(ThinkFilter.CLOSE);
        if (close === -1) {
          const keep = Math.min(this.tail.length, ThinkFilter.CLOSE.length - 1);
          this.tail = this.tail.slice(this.tail.length - keep);
          return;
        }
        this.tail = this.tail.slice(close + ThinkFilter.CLOSE.length);
        this.inside = false;
      }
    }
  }

  flush(emit: (s: string) => void): void {
    if (!this.inside && this.tail) emit(this.tail);
    this.tail = "";
  }
}

/**
 * Adapter for OpenRouter models (free tier per PRD §6.4).
 * Availability: needs OPENROUTER_API_KEY; router falls back to local on 429/error.
 */
export class OpenRouterProvider implements LLMProvider {
  readonly name = "openrouter";

  /** When the daily free-tier limit is hit, ignore OpenRouter until this epoch (ms). */
  private dailyLimitUntil = 0;

  constructor(private apiKey: string = process.env.OPENROUTER_API_KEY ?? "") {}

  get hasKey(): boolean {
    return this.apiKey.length > 0 && Date.now() >= this.dailyLimitUntil;
  }

  /** True when the free tier's daily quota is exhausted (checked via rate-limit headers). */
  get dailyLimitHit(): boolean {
    return Date.now() < this.dailyLimitUntil;
  }

  async generate(opts: GenerateOptions, onDelta: (chunk: string) => void): Promise<string> {
    if (!this.apiKey) throw new ProviderError("OPENROUTER_API_KEY not configured", 401, "openrouter");

    let full: string;
    try {
      full = await this.doGenerate(opts, onDelta);
    } catch (err) {
      // Daily free-tier exhaustion → skip OpenRouter entirely until the quota resets
      // instead of burning a round-trip on every candidate for the rest of the day.
      if (err instanceof ProviderError && err.status === 429 && /per-day|daily|rate.?limit/i.test(err.message)) {
        this.dailyLimitUntil = Date.now() + 60 * 60_000;
      }
      throw err;
    }
    return full;
  }

  private async doGenerate(opts: GenerateOptions, onDelta: (chunk: string) => void): Promise<string> {
    let full = "";
    const filter = new ThinkFilter();
    const emit = (s: string) => {
      full += s;
      onDelta(s);
    };
    for await (const part of streamChatCompletions(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        Authorization: `Bearer ${this.apiKey}`,
        "HTTP-Referer": "http://localhost:5173",
        "X-Title": "Ponder",
      },
      {
        model: opts.model,
        stream: true,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.prompt },
        ],
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        temperature: opts.temperature ?? 0.7,
        ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      },
      opts.abort,
    )) {
      if (part.delta) {
        filter.push(part.delta, emit);
      }
    }
    filter.flush(emit);
    // Some free models answer with visible filler like "..." or a thinking-tag
    // remnant instead of real content. Treat anything without an actual
    // alphanumeric word as empty so the router fails over to the next candidate.
    if (!/[A-Za-z0-9\u00C0-\u024F]/.test(full)) {
      throw new ProviderError(`Empty completion from openrouter:${opts.model}`, 502, "openrouter");
    }
    return full;
  }

  /**
   * Live free-model discovery from the OpenRouter catalog (PRD §10: capabilities
   * check on startup rather than hardcoding — the free list changes constantly).
   * Returns model ids ending in ":free", sorted by context length (desc).
   */
  async listFreeModels(): Promise<{ id: string; name: string; context_length: number }[]> {
    if (!this.apiKey) return [];
    try {
      const res = await fetch("https://openrouter.ai/api/v1/models", {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      // Daily quota exhausted → stop proposing OpenRouter as a candidate until reset.
      const remaining = res.headers.get("x-ratelimit-remaining");
      if (res.status === 429 || (remaining !== null && Number(remaining) <= 0)) {
        this.dailyLimitUntil = Math.max(this.dailyLimitUntil, Date.now() + 30 * 60_000);
        return [];
      }
      if (!res.ok) return [];
      const body = (await res.json()) as {
        data?: { id: string; name?: string; context_length?: number; pricing?: { prompt?: string; completion?: string } }[];
      };
      return (body.data ?? [])
        .filter((m) => m.id.endsWith(":free"))
        .filter((m) => {
          const p = m.pricing;
          // defense in depth: catalog label says free, pricing must say so too
          return !p || (Number(p.prompt ?? "0") === 0 && Number(p.completion ?? "0") === 0);
        })
        .map((m) => ({ id: m.id, name: m.name ?? m.id, context_length: m.context_length ?? 0 }))
        // reasoning models last: their hidden CoT often degrades short-form tutoring output
        .sort((a, b) => {
          const ra = /r1|qwq|thinking|reasoning|nemotron|inkling/i.test(a.id) ? 1 : 0;
          const rb = /r1|qwq|thinking|reasoning|nemotron|inkling/i.test(b.id) ? 1 : 0;
          if (ra !== rb) return ra - rb;
          return b.context_length - a.context_length;
        });
    } catch {
      return [];
    }
  }
}
