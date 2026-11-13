import OpenAI from "openai";
import type { AiProvider, AiRequest, AiResponse } from "./provider";

/** OpenAI's chat completions with a strict JSON schema response format. */
export function openaiProvider(options: { apiKey: string; model: string; baseURL?: string }): AiProvider {
  const client = new OpenAI({ apiKey: options.apiKey, baseURL: options.baseURL, maxRetries: 1, timeout: 90_000 });
  return {
    name: "openai",
    model: options.model,
    async generate(request: AiRequest): Promise<AiResponse> {
      const completion = await client.chat.completions.create({
        model: options.model,
        max_completion_tokens: request.maxTokens,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.prompt },
        ],
        response_format: { type: "json_schema", json_schema: { name: "result", schema: request.schema, strict: true } },
      });
      const usage = {
        model: completion.model,
        inputTokens: completion.usage?.prompt_tokens ?? 0,
        outputTokens: completion.usage?.completion_tokens ?? 0,
      };
      const choice = completion.choices[0];
      if (!choice || choice.message.refusal) return { kind: "refused", ...usage };
      if (choice.finish_reason !== "stop" || !choice.message.content) return { kind: "incomplete", ...usage };
      try {
        return { kind: "ok", json: JSON.parse(choice.message.content), ...usage };
      } catch {
        return { kind: "incomplete", ...usage };
      }
    },
  };
}
