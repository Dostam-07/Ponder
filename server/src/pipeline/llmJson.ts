import type { ModelRouter } from "../llm/router.js";
import { extractJsonLenient } from "../llm/router.js";

type JsonOpts = Omit<Parameters<ModelRouter["generateJson"]>[1], never>;

/**
 * JSON generation that survives truncated small-model output: retries strictly
 * first (via the router), then repairs a truncated object by closing its open
 * containers before giving up.
 */
export async function generateJsonLenient<T = unknown>(
  router: ModelRouter,
  speed: "fast" | "quality",
  opts: JsonOpts,
): Promise<T> {
  try {
    return (await router.generateJsonWithRetry(speed, opts)) as T;
  } catch (err) {
    const { text } = await router.generateWithFailover(speed, { ...opts, json: true });
    const repaired = extractJsonLenient(text);
    if (repaired) return JSON.parse(repaired) as T;
    throw err;
  }
}
