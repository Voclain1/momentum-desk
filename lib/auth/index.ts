import { db } from "@/lib/db";
import { defaultEmailSender } from "@/lib/email";
import { parseEnv } from "@/lib/env";
import { appOrigins } from "./origins";
import { createAuth } from "./server";

const env = parseEnv(process.env);

/** The app's Better Auth instance. Server-only. */
export const auth = createAuth({
  db,
  email: defaultEmailSender(env),
  secret: env.BETTER_AUTH_SECRET,
  ...appOrigins(process.env),
});
