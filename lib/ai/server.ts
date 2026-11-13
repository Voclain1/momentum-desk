import { parseEnv } from "@/lib/env";
import { tenantData } from "@/lib/tenant";
import { anthropicProvider } from "./anthropic";
import { openaiProvider } from "./openai";
import type { AiProvider } from "./provider";
import type { AiDeps } from "./service";

const env = parseEnv(process.env);

function configuredProvider(): AiProvider | null {
  if (env.AI_PROVIDER === "anthropic" && env.ANTHROPIC_API_KEY) {
    return anthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.AI_MODEL, baseURL: env.AI_TEST_API });
  }
  if (env.AI_PROVIDER === "openai" && env.OPENAI_API_KEY && env.AI_MODEL) {
    return openaiProvider({ apiKey: env.OPENAI_API_KEY, model: env.AI_MODEL, baseURL: env.AI_TEST_API ? `${env.AI_TEST_API}/v1` : undefined });
  }
  return null;
}

/** The app's AI dependencies, from the environment (decision D20). */
export const aiDeps: AiDeps = { data: tenantData, provider: configuredProvider(), serverLimit: env.AI_MONTHLY_LIMIT };

/** Whether AI can run for this workspace now: a provider is configured and the workspace has it on. */
export async function aiAvailable(organizationId: string): Promise<boolean> {
  if (!aiDeps.provider) return false;
  const settings = await tenantData.scoped(organizationId).aiSettings.findFirst();
  return settings?.enabled ?? true;
}
