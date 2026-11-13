import Anthropic from "@anthropic-ai/sdk";
import type { AiProvider, AiRequest, AiResponse } from "./provider";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

/** Claude through the Anthropic API, with JSON output constrained to the task's schema. */
export function anthropicProvider(options: { apiKey: string; model?: string; baseURL?: string }): AiProvider {
  const client = new Anthropic({ apiKey: options.apiKey, baseURL: options.baseURL, maxRetries: 1, timeout: 90_000 });
  const model = options.model ?? DEFAULT_ANTHROPIC_MODEL;
  return {
    name: "anthropic",
    model,
    async generate(request: AiRequest): Promise<AiResponse> {
      const response = await client.beta.messages.create({
        model,
        max_tokens: request.maxTokens,
        // If the model declines, Anthropic re-runs the request on its
        // recommended fallback model in the same call.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: request.system,
        messages: [{ role: "user", content: request.prompt }],
        output_config: { effort: "medium", format: { type: "json_schema", schema: request.schema } },
      });
      const usage = { model: response.model, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
      if (response.stop_reason === "refusal") return { kind: "refused", ...usage };
      if (response.stop_reason === "max_tokens") return { kind: "incomplete", ...usage };
      const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
      try {
        return { kind: "ok", json: JSON.parse(text), ...usage };
      } catch {
        return { kind: "incomplete", ...usage };
      }
    },
  };
}
