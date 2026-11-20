import { headers } from "next/headers";
import { db } from "@/lib/db";
import { clientAddress, createRateLimiter, LIMITS } from "./rate-limit";

export const rateLimiter = createRateLimiter(db);

/** Counts one request from this client (or `subject`, e.g. a user id) against a scope's limit. */
export async function rateLimit(scope: keyof typeof LIMITS, subject?: string) {
  const [limit, windowSeconds] = LIMITS[scope];
  return rateLimiter.hit(scope, subject ?? clientAddress(await headers()), limit, windowSeconds);
}
