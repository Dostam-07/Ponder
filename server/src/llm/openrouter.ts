import type { GenerateOptions, LLMProvider } from "./provider.js";
import { ProviderError, streamChatCompletions } from "./provider.js";
import type { PictureErrorCode } from "@canvas-learn/shared";

export class PictureGenerationError extends ProviderError {
  constructor(message: string, status: number, public readonly code: PictureErrorCode) {
    super(message, status, "openrouter");
    this.name = "PictureGenerationError";
  }
}

/** Provider response bodies may contain raw diagnostics or credentials. Only
 * known status-based guidance is returned to the UI or persisted in a canvas. */
function pictureHttpError(status: number): PictureGenerationError {
  if (status === 402) return new PictureGenerationError("This OpenRouter account or API key has insufficient credits for picture generation. Add credits or use a funded key in Settings → AI & connections, then retry the picture.", status, "credits_required");
  if (status === 401 || status === 403) return new PictureGenerationError("OpenRouter rejected the picture request. Check your API key, account, and model access in Settings → AI & connections.", status, "key_rejected");
  if (status === 400 || status === 404 || status === 422) return new PictureGenerationError("This picture model is unavailable or does not support this image request. Check the Picture model in Settings → AI & connections.", status, "model_unavailable");
  if (status === 429) return new PictureGenerationError("OpenRouter is temporarily rate-limiting picture generation. Wait a moment, then retry the picture.", status, "rate_limited");
  return new PictureGenerationError("The picture provider is temporarily unavailable. Try again shortly.", status, "provider_unavailable");
}

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

  private savedImageModel: string | null = null;

  /** Apply Settings immediately; null restores the environment fallback. */
  configure(apiKey: string | null, imageModel: string | null) {
    const nextKey = apiKey ?? process.env.OPENROUTER_API_KEY?.trim() ?? "";
    if (this.apiKey !== nextKey) this.dailyLimitUntil = 0;
    this.apiKey = nextKey;
    this.savedImageModel = imageModel;
  }

  get configured(): boolean {
    return this.apiKey.length > 0;
  }

  get keyHint(): string {
    return this.apiKey.length >= 8 ? `••••${this.apiKey.slice(-4)}` : this.apiKey ? "••••" : "";
  }

  get imageModel(): string {
    return this.savedImageModel || process.env.OPENROUTER_IMAGE_MODEL?.trim() || "google/gemini-2.5-flash-image";
  }

  /** Verify authentication without generating text or a billable picture. */
  async testConnection(): Promise<void> {
    if (!this.configured) throw new ProviderError("Add and save your OpenRouter API key first", 400, "openrouter");
    const response = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new ProviderError(
        response.status === 401 || response.status === 403
          ? "OpenRouter rejected this key. Check the key and try again."
          : `OpenRouter connection check failed (HTTP ${response.status}). Try again shortly.`,
        response.status,
        "openrouter",
      );
    }
  }

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

  /** Generate one persisted image through OpenRouter's dedicated Image API. */
  async generateImage(prompt: string, abort?: AbortSignal): Promise<{ dataUrl: string; mediaType: string; model: string }> {
    if (!this.apiKey) throw new PictureGenerationError("Add and save an OpenRouter API key in Settings → AI & connections before generating pictures.", 401, "key_required");
    const model = this.imageModel;
    const res = await fetch("https://openrouter.ai/api/v1/images", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "HTTP-Referer": "http://localhost:5173",
        "X-Title": "Ponder",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        prompt,
        n: 1,
        aspect_ratio: "16:9",
      }),
      signal: abort
        ? AbortSignal.any([abort, AbortSignal.timeout(180_000)])
        : AbortSignal.timeout(180_000),
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw pictureHttpError(res.status);
    }
    const body = (await res.json()) as {
      data?: { b64_json?: string; media_type?: string }[];
      error?: { code?: number | string };
    };
    const image = body.data?.[0];
    if (typeof image?.b64_json !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.b64_json)) {
      const status = Number(body.error?.code);
      if (status >= 400 && status < 600) throw pictureHttpError(status);
      throw new PictureGenerationError("Picture generation returned no image. Check the Picture model in Settings and try again.", 502, "no_image");
    }
    if (image.b64_json.length > 20 * 1024 * 1024) {
      throw new ProviderError("The generated picture is too large to store — try a smaller image model", 502, "openrouter");
    }
    const mediaType = image.media_type?.startsWith("image/") ? image.media_type : "image/png";
    return { dataUrl: `data:${mediaType};base64,${image.b64_json}`, mediaType, model };
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
