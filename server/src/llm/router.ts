import type { LLMProvider } from "./provider.js";
import { ProviderError } from "./provider.js";
import { OllamaProvider } from "./ollama.js";
import { OpenRouterProvider } from "./openrouter.js";
import { resolveModels, type ModelsConfig } from "./modelConfig.js";

export type ModelSpeed = "fast" | "quality";

export interface ModelRouterConfig {
  fastModel: string; // local small model (stage 1/2 fallback)
  qualityModel: string; // larger local model (stage 3 fallback)
  preferOpenRouter: boolean; // use free OpenRouter models first when keyed
}

// Documented FALLBACK defaults — the last rung of the precedence ladder
// (env var > saved preference > these). They are models whose /api/chat path is
// verified working on this machine (CPU-only): qwen2.5:7b and the 14b instruct
// hang indefinitely on chat calls (live diagnosis 2026-10-03 — zero tokens for
// 3+ min, both streaming and blocking, across Ollama restarts), while these
// sustain 2.8–4.9 tok/s warm.
const BASE_DEFAULTS: Omit<ModelRouterConfig, "preferOpenRouter"> = {
  fastModel: "llama3.2:3b",
  qualityModel: "gemma3:4b",
};

const DEFAULTS: ModelRouterConfig = {
  ...BASE_DEFAULTS,
  preferOpenRouter: (process.env.CANVAS_PREFER_OPENROUTER ?? "true") === "true",
};

/** A candidate generation path, tried in order. */
interface Candidate {
  provider: LLMProvider;
  model: string;
  label: string;
}

export class ModelRouter {
  readonly ollama = new OllamaProvider();
  readonly openrouter = new OpenRouterProvider();
  private cfg: ModelRouterConfig;
  /** Locally saved model preferences (Settings UI) — the second precedence rung. */
  private savedModels: { fast: string | null; quality: string | null } = { fast: null, quality: null };
  /** Installed Ollama model names (10-min cache). null = never discovered. */
  private installedNames: string[] | null = null;
  private installedCheckedAt = 0;
  /** Free OpenRouter model ids, refreshed lazily (catalog changes frequently — PRD §10). */
  private freeModels: string[] = [];
  private freeModelsFetched = false;
  /** Round-robin pointer across free models so we don't hammer one rate limit. */
  private rr = 0;
  /** Cooldowns: model id → epoch ms until which it is skipped (rate-limit backoff). */
  private cooldowns = new Map<string, number>();
  /** Tiny local model for cheap structured calls (auto-detected from Ollama's catalog). */
  private tinyLocalModel: string | null = null;
  private tinyModelChecked = false;

  constructor(cfg: Partial<ModelRouterConfig> = {}) {
    this.cfg = { ...DEFAULTS, ...cfg };
  }

  /** Store the Settings-UI model preferences (second precedence rung). */
  setSavedModels(fast: string | null, quality: string | null) {
    this.savedModels = { fast, quality };
  }

  /**
   * Refresh the installed-model list from Ollama (10-minute cache, tolerant of
   * Ollama being down — models live on disk, so a stale list stays valid).
   */
  async ensureInstalledModels(): Promise<string[]> {
    const now = Date.now();
    if (this.installedNames != null && now - this.installedCheckedAt < 600_000) return this.installedNames;
    try {
      const caps = await this.ollama.capabilities();
      if (caps && typeof caps === "object" && "models" in caps) {
        this.installedNames = ((caps as { models?: { name: string }[] }).models ?? []).map((m) => m.name);
      }
    } catch {
      // keep the last known list
    }
    this.installedCheckedAt = now;
    return this.installedNames ?? [];
  }

  /** The effective model configuration right now (pure resolution — see modelConfig.ts). */
  effectiveModels(): ModelsConfig {
    return resolveModels({
      envFast: process.env.CANVAS_FAST_MODEL,
      envQuality: process.env.CANVAS_QUALITY_MODEL,
      savedFast: this.savedModels.fast,
      savedQuality: this.savedModels.quality,
      defaultFast: this.cfg.fastModel,
      defaultQuality: this.cfg.qualityModel,
      installed: this.installedNames,
      ollamaReachable: this.installedNames != null,
    });
  }

  /** Find the smallest capable local model for JSON side-calls (cached for the process). */
  private async resolveTinyModel(): Promise<string | null> {
    if (this.tinyModelChecked) return this.tinyLocalModel;
    this.tinyModelChecked = true;
    try {
      const caps = (await this.ollama.capabilities()) as { models?: { name: string }[] } | null;
      const names = (caps?.models ?? []).map((m) => m.name);
      const preferred = [/^qwen2\.5:1\.5b$/, /^phi4-mini/, /^llama3\.2:3b$/, /^gemma3:4b$/];
      for (const re of preferred) {
        const hit = names.find((n) => re.test(n));
        if (hit) {
          this.tinyLocalModel = hit;
          break;
        }
      }
    } catch {
      // Ollama unreachable → no tiny model
    }
    return this.tinyLocalModel;
  }

  /** Refresh the free-model catalog at most once per 10 minutes. */
  async refreshFreeModels(force = false): Promise<string[]> {
    const now = Date.now();
    if (!force && this.freeModelsFetched && now - this.lastFreeFetch < 600_000) return this.freeModels;
    this.lastFreeFetch = now;
    this.freeModelsFetched = true;
    const models = await this.openrouter.listFreeModels();
    this.freeModels = models.map((m) => m.id);
    return this.freeModels;
  }

  private lastFreeFetch = 0;

  private isCoolingDown(label: string): boolean {
    const until = this.cooldowns.get(label);
    return typeof until === "number" && until > Date.now();
  }

  private cooldown(label: string, ms = 60_000) {
    this.cooldowns.set(label, Date.now() + ms);
  }

  /**
   * Candidate list for a stage: OpenRouter free models first (round-robin, when
   * keyed+preferred), then the local model. Every candidate can serve every stage;
   * failover walks the list (PRD §8: graceful fallback on free-tier limits).
   */
  private candidates(speed: ModelSpeed): Candidate[] {
    const list: Candidate[] = [];
    if (this.openrouter.hasKey && this.cfg.preferOpenRouter) {
      const available = this.freeModels.filter((m) => !this.isCoolingDown(`openrouter:${m}`));
      // Capped at 3: every remote candidate can burn its first-token timeout before
      // the local model is reached, so a longer list only adds worst-case latency.
      for (let i = 0; i < available.length && list.length < 3; i++) {
        const model = available[(this.rr + i) % available.length]!;
        list.push({ provider: this.openrouter, model, label: `openrouter:${model}` });
      }
    }
    // Effective model = env var > saved preference (if installed) > documented
    // default (resolveModels). Evaluated live so Settings changes apply at once.
    const eff = this.effectiveModels();
    const local = speed === "fast" ? eff.fast.effective : eff.quality.effective;
    list.push({ provider: this.ollama, model: local, label: `ollama:${local}` });
    return list;
  }

  /** Preferred primary path for display/health (no network calls). */
  resolve(speed: ModelSpeed, opts: { explicitModel?: string } = {}): { provider: LLMProvider; model: string } {
    if (opts.explicitModel) {
      if (opts.explicitModel.includes("/")) {
        return { provider: this.openrouter, model: opts.explicitModel };
      }
      return { provider: this.ollama, model: opts.explicitModel };
    }
    const first = this.candidates(speed)[0]!;
    return { provider: first.provider, model: first.model };
  }

  /** Startup capabilities check (PRD §10). Also feeds the effective-model resolution. */
  async capabilities() {
    const [local, free] = await Promise.all([this.ollama.capabilities(), this.refreshFreeModels()]);
    const models =
      local && typeof local === "object" && "models" in local
        ? ((local as { models?: { name: string }[] }).models ?? []).map((m) => m.name)
        : [];
    // Remember the installed list so saved-preference validation works without
    // an extra round trip (only when Ollama is actually reachable).
    if (local != null) {
      this.installedNames = models;
      this.installedCheckedAt = Date.now();
    }
    const eff = this.effectiveModels();
    return {
      ollama_reachable: local != null,
      local_models: models,
      // EFFECTIVE models (env > saved > default), not the raw fallback defaults
      fast_model: eff.fast.effective,
      quality_model: eff.quality.effective,
      fast_model_source: eff.fast.source,
      quality_model_source: eff.quality.source,
      fast_model_saved: eff.fast.saved,
      quality_model_saved: eff.quality.saved,
      fast_saved_ignored: eff.fast.savedIgnored,
      fast_saved_ignore_reason: eff.fast.savedIgnoreReason,
      quality_saved_ignored: eff.quality.savedIgnored,
      quality_saved_ignore_reason: eff.quality.savedIgnoreReason,
      openrouter_keyed: this.openrouter.hasKey,
      prefer_openrouter: this.cfg.preferOpenRouter,
      openrouter_free_models: free,
    };
  }

  /**
   * Streamed generation with ordered failover: tries each candidate until one
   * succeeds. Rate limits (429) put that model on a 60s cooldown and advance the
   * round-robin pointer so the next request starts elsewhere.
   * Returns the full text plus which candidate produced it.
   */
  async generateWithFailover(
    speed: ModelSpeed,
    opts: Omit<Parameters<LLMProvider["generate"]>[0], "model">,
    onDelta?: (chunk: string) => void,
    onRetry?: () => void,
  ): Promise<{ text: string; provider: string; model: string }> {
    if (this.openrouter.hasKey && this.cfg.preferOpenRouter && !this.freeModelsFetched) {
      await this.refreshFreeModels();
    }
    // resolve a possibly-saved model against the current installed list first
    await this.ensureInstalledModels();
    const cands = this.candidates(speed);
    let lastErr: unknown;
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i]!;
      if (i > 0) onRetry?.(); // previous candidate may have emitted partial deltas
      // Per-candidate watchdog (live finding: free models can stream NOTHING for
      // minutes — reasoning-blanked or queued responses — which froze the failover
      // chain and left the UI on "Ponder is thinking" indefinitely). Three bounds:
      //   first token: remote 20s / local 150s (cold model load + CPU queueing
      //                 behind another ask's pipeline stages are both normal)
      //   stall:       30s of silence mid-stream
      //   hard cap:    remote 4 min (free models misbehave) / local 10 min — CPU
      //                 models stream steadily at ~1.5-5 tok/s, so a full 400-token
      //                 quality-mode answer can legitimately take 5+ minutes; the
      //                 first-token and stall bounds catch genuinely stuck calls.
      // An aborted candidate is just a failed candidate: the loop moves on.
      const ctrl = new AbortController();
      const onCallerAbort = () => ctrl.abort();
      opts.abort?.addEventListener("abort", onCallerAbort, { once: true });
      let firstTokenSeen = false;
      let streamed = "";
      let firstTimer: ReturnType<typeof setTimeout> | undefined;
      let stallTimer: ReturnType<typeof setTimeout> | undefined;
      const capTimer = setTimeout(() => ctrl.abort(), c.provider === this.openrouter ? 240_000 : 600_000);
      const armStall = () => {
        clearTimeout(stallTimer);
        stallTimer = setTimeout(() => ctrl.abort(), 30_000);
      };
      const clearWatchdog = () => {
        clearTimeout(firstTimer);
        clearTimeout(stallTimer);
        clearTimeout(capTimer);
      };
      firstTimer = setTimeout(
        () => ctrl.abort(),
        c.provider === this.openrouter ? 20_000 : 150_000,
      );
      const wrappedDelta = (chunk: string) => {
        if (!firstTokenSeen) {
          firstTokenSeen = true;
          clearTimeout(firstTimer);
        }
        armStall();
        streamed += chunk;
        onDelta?.(chunk);
      };
      try {
        const text = await c.provider.generate(
          { ...opts, model: c.model, abort: ctrl.signal },
          wrappedDelta,
        );
        // An empty/whitespace completion is a FAILURE, not an answer: some free
        // models return 200 with zero content (truncated reasoning, safety
        // blanking, …). Previously this fell through as "success" and downstream
        // stages invented filler around nothing ("No explanation was provided…").
        // Treat it like any other candidate failure so the next candidate runs.
        if (!text || !text.trim()) {
          throw new ProviderError(`Empty completion from ${c.label}`, undefined, c.provider.name);
        }
        if (c.provider === this.openrouter) this.rr = (this.rr + 1) % Math.max(this.freeModels.length, 1);
        return { text, provider: c.provider.name, model: c.model };
      } catch (err) {
        // Surface a real diagnosis when OUR watchdog aborted the candidate (the raw
        // fetch AbortError says nothing useful and would end up in the UI error).
        if (ctrl.signal.aborted && !opts.abort?.aborted && !(err instanceof ProviderError)) {
          err = new ProviderError(
            `${c.label} ${firstTokenSeen ? "stalled mid-stream" : "produced no output in time"}`,
            504,
            c.provider.name,
          );
        }
        // A watchdog abort mid-stream need not waste real content: if the candidate
        // streamed a substantive partial answer before stalling, accept it rather
        // than failing the whole ask — a truncated-but-real answer beats an error
        // card (the user already watched it stream). Never for JSON mode (a partial
        // JSON object is unparseable) and never when the CALLER aborted: a user
        // cancellation means discard.
        if (
          ctrl.signal.aborted &&
          !opts.abort?.aborted &&
          firstTokenSeen &&
          !opts.json &&
          streamed.trim().length >= 120
        ) {
          return { text: streamed.trimEnd(), provider: c.provider.name, model: c.model };
        }
        lastErr = err;
        // Cooldown policy learned from the live catalog: 429 = per-model rate limit
        // (2 min); 403 = model restricted to agentic harnesses, effectively permanent
        // for this session; anything else gets a short retry window.
        const status = err instanceof ProviderError ? err.status : undefined;
        this.cooldown(c.label, status === 429 ? 120_000 : status === 403 ? 6 * 3600_000 : 30_000);
      } finally {
        clearWatchdog();
        opts.abort?.removeEventListener("abort", onCallerAbort);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  /** JSON generation with failover; parses the winning text. */
  async generateJson(speed: ModelSpeed, opts: Omit<Parameters<LLMProvider["generate"]>[0], "model" | "json">): Promise<unknown> {
    // Small structured outputs don't need the main fast model: on CPU-only local
    // inference a 7B call costs ~30s while a 1.5B call costs ~3s. Prefer a tiny
    // local model for JSON when OpenRouter is unavailable (quota/key), keeping
    // quality fallbacks in the failover chain.
    const openrouterUsable = this.openrouter.hasKey && this.cfg.preferOpenRouter;
    const tiny = openrouterUsable ? null : this.tinyLocalModel ?? (await this.resolveTinyModel());
    if (tiny) {
      try {
        // This fast path bypasses the generateWithFailover watchdogs, so it must
        // be bounded itself: a stalled local call would hang the whole ask
        // (the SSE stream never ends and the client's composer stays locked).
        // The tiny model answers in seconds — 60s is very generous.
        const text = await Promise.race([
          this.ollama.generate({ ...opts, model: tiny, json: true }, () => {}),
          new Promise<never>((_, reject) => {
            const t = setTimeout(() => reject(new Error("tiny-model timeout")), 60_000);
            t.unref?.();
          }),
        ]);
        return JSON.parse(extractJson(text));
      } catch {
        // fall through to the standard failover chain
      }
    }
    const { text } = await this.generateWithFailover(speed, { ...opts, json: true });
    return JSON.parse(extractJson(text));
  }

  /**
   * JSON generation with automatic retry on parse failure — free models sometimes
   * emit chatty preamble or truncate; one stricter retry recovers most of those.
   */
  async generateJsonWithRetry(speed: ModelSpeed, opts: Omit<Parameters<LLMProvider["generate"]>[0], "model" | "json">): Promise<unknown> {
    try {
      return await this.generateJson(speed, opts);
    } catch {
      return await this.generateJson(speed, {
        ...opts,
        temperature: Math.min(opts.temperature ?? 0.3, 0.1),
        prompt: `${opts.prompt}\n\nIMPORTANT: Output ONLY the JSON object, starting with { and ending with }. No commentary, no markdown fences.`,
      });
    }
  }
}

/** Best-effort extraction of a JSON object from a chatty model response. */
export function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start !== -1 && end > start) return candidate.slice(start, end + 1);
  return candidate.trim();
}

/**
 * Extract a JSON object that may be TRUNCATED (token cap / model cut-off):
 * finds the leading '{' and then closes unbalanced strings/arrays/objects.
 * Returns null only when the text contains no object start at all.
 */
export function extractJsonLenient(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  const stack: string[] = [];
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") {
      depth++;
      stack.push("}");
    } else if (ch === "[") {
      depth++;
      stack.push("]");
    } else if (ch === "}" || ch === "]") {
      depth--;
      stack.pop();
    }
  }
  if (depth === 0) return text.slice(start);
  // close open string and any open containers
  let out = text.slice(start);
  if (inStr) out += '"';
  while (stack.length) out += stack.pop();
  return out;
}
