/**
 * The app's public origin (APP_URL). Better Auth rejects requests from an
 * origin it does not know; on the VPS (decision D9) the app is served from
 * exactly one origin. Locally, without APP_URL, the origin is the request's.
 */
export function appOrigins(env: Record<string, string | undefined>): { baseURL?: string; trustedOrigins: string[] } {
  const baseURL = env.APP_URL || undefined;
  return { baseURL, trustedOrigins: baseURL ? [baseURL] : [] };
}
