import { parseEnv } from "@/lib/env";
import { publicLinks, tenantData } from "@/lib/tenant";
import { providerHttp } from "./http";
import type { OnlineDeps } from "./online";

const env = parseEnv(process.env);

/** Online payment wiring for the app (server only). */
export const onlineDeps: OnlineDeps = {
  data: tenantData,
  links: publicLinks,
  secretsKey: env.PROVIDER_SECRETS_KEY,
  http: providerHttp(env),
};

export const providerSecretsConfigured = Boolean(env.PROVIDER_SECRETS_KEY);
