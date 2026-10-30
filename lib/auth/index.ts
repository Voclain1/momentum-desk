import { db } from "@/lib/db";
import { defaultEmailSender } from "@/lib/email";
import { parseEnv } from "@/lib/env";
import { createAuth } from "./server";

const env = parseEnv(process.env);

/** The app's Better Auth instance. Server-only. */
export const auth = createAuth({
  db,
  email: defaultEmailSender(env),
  secret: env.BETTER_AUTH_SECRET,
  // Vercel previews have no fixed origin; fall back to the deployment URL.
  baseURL: env.APP_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined),
});
