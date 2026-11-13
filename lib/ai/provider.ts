/**
 * The provider-neutral AI interface (decision D20). Every Momentum AI task
 * asks for JSON matching a schema; adapters for Anthropic and OpenAI sit
 * behind it, chosen by AI_PROVIDER. Nothing here stores prompts or output.
 */

export type JsonSchema = Record<string, unknown>;

export interface AiRequest {
  system: string;
  prompt: string;
  schema: JsonSchema;
  maxTokens: number;
}

interface Usage {
  /** The model that answered (may differ from the configured one after a fallback). */
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export type AiResponse =
  | ({ kind: "ok"; json: unknown } & Usage)
  /** The model declined the request. */
  | ({ kind: "refused" } & Usage)
  /** The answer was cut off or was not JSON. */
  | ({ kind: "incomplete" } & Usage);

export interface AiProvider {
  name: "anthropic" | "openai";
  model: string;
  generate(request: AiRequest): Promise<AiResponse>;
}

/** Estimated US-dollar price per million tokens, input and output. */
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-opus-5": [5, 25],
  "claude-opus-4-8": [5, 25],
  "claude-sonnet-5-5": [2, 10],
  "claude-sonnet-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};

/**
 * Estimated cost in millionths of a dollar (a dollar per million tokens is a
 * millionth of a dollar per token); null when the model's price is unknown.
 */
export function estimateCostMicros(model: string, inputTokens: number, outputTokens: number): bigint | null {
  const price = PRICES[model];
  if (!price) return null;
  return BigInt(Math.round(inputTokens * price[0] + outputTokens * price[1]));
}
