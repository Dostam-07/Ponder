/**
 * Model configuration resolution — single source of truth for the
 * fast/quality model precedence (spec: model picker in Settings).
 *
 *   environment variable  >  locally saved preference (if still installed)  >  documented default
 *
 * The function is pure and total: any combination of inputs resolves to exactly
 * one model per role, with the SOURCE recorded so the UI can explain what is
 * actually in effect (e.g. "env var is overriding your saved choice").
 */
export type ModelRole = "fast" | "quality";
export type ModelSource = "env" | "saved" | "default";

export interface ModelRoleConfig {
  /** the model that will actually be used */
  effective: string;
  /** where the effective choice came from */
  source: ModelSource;
  /** the locally saved preference (may be null, and may be overridden) */
  saved: string | null;
  /** the environment variable value if set (else null) */
  env: string | null;
  /** the documented fallback default */
  fallback: string;
  /** true when a saved preference exists but is NOT in effect (env override or model uninstalled) */
  savedIgnored: boolean;
  /** why a saved preference (if any) is not in effect */
  savedIgnoreReason: "env_override" | "not_installed" | null;
}

export interface ModelsConfig {
  fast: ModelRoleConfig;
  quality: ModelRoleConfig;
  /** installed local model names (empty when Ollama is unreachable) */
  installed: string[];
  /** ollama reachable at resolution time */
  ollamaReachable: boolean;
}

export interface ResolveInput {
  envFast: string | undefined;
  envQuality: string | undefined;
  savedFast: string | null;
  savedQuality: string | null;
  defaultFast: string;
  defaultQuality: string;
  /** installed local models; null/empty means "unknown" (Ollama unreachable or not yet discovered) */
  installed: string[] | null;
  ollamaReachable?: boolean;
}

function resolveRole(
  role: ModelRole,
  input: ResolveInput,
  fallback: string,
  saved: string | null,
): ModelRoleConfig {
  const env = (role === "fast" ? input.envFast : input.envQuality)?.trim() ?? null;
  if (env) {
    return {
      effective: env,
      source: "env",
      saved,
      env,
      fallback,
      savedIgnored: saved != null && saved !== env,
      savedIgnoreReason: saved != null && saved !== env ? "env_override" : null,
    };
  }
  if (saved) {
    // "where valid" = still installed. An empty/unknown installed list means we
    // cannot verify — trust the saved preference (it was validated when saved).
    if (input.installed && input.installed.length > 0 && !input.installed.includes(saved)) {
      return {
        effective: fallback,
        source: "default",
        saved,
        env: null,
        fallback,
        savedIgnored: true,
        savedIgnoreReason: "not_installed",
      };
    }
    return { effective: saved, source: "saved", saved, env: null, fallback, savedIgnored: false, savedIgnoreReason: null };
  }
  return { effective: fallback, source: "default", saved: null, env: null, fallback, savedIgnored: false, savedIgnoreReason: null };
}

/** Resolve the effective model configuration (pure — trivially unit-testable). */
export function resolveModels(input: ResolveInput): ModelsConfig {
  return {
    fast: resolveRole("fast", input, input.defaultFast, input.savedFast),
    quality: resolveRole("quality", input, input.defaultQuality, input.savedQuality),
    installed: input.installed ?? [],
    ollamaReachable: input.ollamaReachable ?? (input.installed != null),
  };
}
