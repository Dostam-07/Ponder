import type { GenerateOptions, LLMProvider } from "./provider.js";
import { ProviderError } from "./provider.js";

/** Adapter for a local Ollama server using its native /api/chat streaming API. */
export class OllamaProvider implements LLMProvider {
  readonly name = "ollama";

  constructor(private baseUrl: string = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434") {}

  async generate(opts: GenerateOptions, onDelta: (chunk: string) => void): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.model,
        stream: true,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.prompt },
        ],
        ...(opts.json ? { format: "json" } : {}),
        options: {
          temperature: opts.temperature ?? 0.7,
          ...(opts.maxTokens ? { num_predict: opts.maxTokens } : {}),
        },
        keep_alive: "30m",
      }),
      signal: opts.abort,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ProviderError(`Ollama HTTP ${res.status}: ${text.slice(0, 300)}`, res.status, "ollama");
    }
    if (!res.body) throw new ProviderError("Empty body", undefined, "ollama");

    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.message?.content) {
            full += parsed.message.content;
            onDelta(parsed.message.content);
          }
          if (parsed.done) break;
        } catch {
          // partial line, keep buffering
        }
      }
    }
    // Empty local completions (model unloaded, template quirk) must fail the
    // candidate too — downstream stages otherwise invent filler around nothing.
    if (!/[A-Za-z0-9\u00C0-\u024F]/.test(full)) {
      throw new ProviderError(`Empty completion from ollama:${opts.model}`, 502, "ollama");
    }
    return full;
  }

  async capabilities(): Promise<unknown | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }
}
