import { parseEnv } from "@/lib/env";
import { appOrigins } from "@/lib/auth/origins";
import { defaultEmailSender } from "./index";

const env = parseEnv(process.env);

/** The app's email sender (decision D17). Server-only. */
export const emailSender = defaultEmailSender(env);

/** Absolute links in emails use the app's public origin; a request's own origin otherwise. */
export function publicOrigin(requestOrigin: string): string {
  return appOrigins(process.env).baseURL ?? requestOrigin;
}
