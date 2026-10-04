/** Common provider interface — Ollama and OpenRouter both implement this (PRD §6.4). */

export interface GenerateOptions {
  model: string;
  system: string;
  prompt: string;
  temperature?: number;
  /** Force valid JSON output (Ollama format:json / OpenRouter response_format) */
  json?: boolean;
  /** Max tokens cap to keep latency bounded */
  maxTokens?: number;
  abort?: AbortSignal;
}

export interface LLMProvider {
  readonly name: string;
  /** Streamed generation; calls onDelta per token chunk, resolves with the full text. */
  generate(opts: GenerateOptions, onDelta: (chunk: string) => void): Promise<string>;
  /** Health/capability probe (e.g. Ollama /api/tags). Null = not applicable. */
  capabilities?(): Promise<unknown | null>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly provider?: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** Minimal SSE-lines parser over a fetch Response body for OpenAI-compatible chat completions. */
export async function* streamChatCompletions(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  abort?: AbortSignal,
): AsyncGenerator<{ delta?: string; finish?: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: abort,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ProviderError(`LLM HTTP ${res.status}: ${text.slice(0, 300)}`, res.status);
  }
  if (!res.body) throw new ProviderError("Empty response body");

  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const parsed = JSON.parse(data);
        const delta: string | undefined = parsed.choices?.[0]?.delta?.content;
        const finish: string | undefined = parsed.choices?.[0]?.finish_reason;
        if (delta) yield { delta };
        if (finish) yield { finish };
      } catch {
        // ignore malformed keepalive lines
      }
    }
  }
}
