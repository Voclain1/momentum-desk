"use client";

import { inferOrgAdditionalFields, magicLinkClient, organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { ac, roles } from "./permissions";
import type { Auth } from "./server";

/**
 * Browser client for Better Auth. Forms use it rather than server actions so
 * requests go through Better Auth's HTTP handler, which applies rate limits.
 */
export const authClient = createAuthClient({
  plugins: [
    organizationClient({ ac, roles, schema: inferOrgAdditionalFields<Auth>() }),
    magicLinkClient(),
  ],
});

/** A readable message from a Better Auth client error. */
export function authErrorMessage(error: { message?: string; status?: number } | null): string {
  if (!error) return "";
  if (error.status === 429) return "Too many attempts. Please wait a minute and try again.";
  return error.message || "Something went wrong. Please try again.";
}
