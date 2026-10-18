import type { MissionProvider } from "../contracts";
import { generationPrompt, repairPrompt } from "../prompts/activity-v2";
import { ProviderError } from "./errors";
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-20b";
export const MAX_GROQ_RESPONSE_BYTES = 96 * 1024;
/** Solo servidor. Transporte oficial sin SDK ni reintentos HTTP ocultos. */
export class GroqProvider implements MissionProvider {
  readonly name = "groq" as const;
  constructor(
    private readonly apiKey: string,
    readonly model = DEFAULT_GROQ_MODEL,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  async propose(
    input: Parameters<MissionProvider["propose"]>[0],
  ): Promise<unknown> {
    if (!this.apiKey.trim()) throw new ProviderError("PROVIDER_NOT_CONFIGURED");
    try {
      const messages = [
        { role: "system", content: input.systemPrompt },
        { role: "user", content: generationPrompt(input.request) },
        ...(input.previousIssues.length
          ? [
              {
                role: "user",
                content: repairPrompt(
                  input.previousIssues,
                  input.previousProposal,
                ),
              },
            ]
          : []),
      ];
      const response = await this.fetchImpl(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          signal: input.signal,
          body: JSON.stringify({
            model: this.model,
            messages,
            response_format: { type: "json_object" },
            max_completion_tokens: 8192,
            temperature: 0.4,
            ...(["openai/gpt-oss-20b", "openai/gpt-oss-120b"].includes(
              this.model,
            )
              ? { reasoning_effort: "low", include_reasoning: false }
              : {}),
            stream: false,
          }),
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 401 || response.status === 403)
          throw new ProviderError("PROVIDER_AUTH");
        if (response.status === 429)
          throw new ProviderError("PROVIDER_RATE_LIMIT");
        if (response.status === 400 || response.status === 422)
          throw new ProviderError("SCHEMA_INVALID");
        throw new ProviderError("PROVIDER_UNAVAILABLE");
      }
      const text = await limitedText(response, input.signal);
      let envelope: unknown;
      try {
        envelope = JSON.parse(text);
      } catch {
        throw new ProviderError("SCHEMA_INVALID");
      }
      if (
        !envelope ||
        typeof envelope !== "object" ||
        !("choices" in envelope) ||
        !Array.isArray(envelope.choices)
      )
        throw new ProviderError("SCHEMA_INVALID");
      const choice = envelope.choices[0];
      if (
        !choice ||
        choice.finish_reason !== "stop" ||
        typeof choice.message?.content !== "string"
      )
        throw new ProviderError("SCHEMA_INVALID");
      try {
        return JSON.parse(choice.message.content) as unknown;
      } catch {
        throw new ProviderError("SCHEMA_INVALID");
      }
    } catch (error) {
      if (input.signal.aborted) throw new ProviderError("PROVIDER_TIMEOUT");
      if (error instanceof ProviderError) throw error;
      throw new ProviderError("PROVIDER_UNAVAILABLE");
    }
  }
}
async function limitedText(
  response: Response,
  signal: AbortSignal,
): Promise<string> {
  if (
    Number(response.headers.get("content-length")) > MAX_GROQ_RESPONSE_BYTES
  ) {
    await response.body?.cancel();
    throw new ProviderError("PROVIDER_RESPONSE_TOO_LARGE");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ProviderError("SCHEMA_INVALID");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      if (signal.aborted) throw new ProviderError("PROVIDER_TIMEOUT");
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_GROQ_RESPONSE_BYTES)
        throw new ProviderError("PROVIDER_RESPONSE_TOO_LARGE");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
