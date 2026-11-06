/**
 * The app's public origin and any other origins it is served from.
 *
 * Production uses APP_URL. A Vercel preview is reachable at both its
 * deployment URL and its branch URL; Better Auth rejects requests from an
 * origin it does not know, so both are trusted when present.
 */
export function appOrigins(env: Record<string, string | undefined>): { baseURL?: string; trustedOrigins: string[] } {
  const vercel = [env.VERCEL_URL, env.VERCEL_BRANCH_URL, env.VERCEL_PROJECT_PRODUCTION_URL]
    .filter((host): host is string => Boolean(host))
    .map((host) => `https://${host}`);
  const baseURL = env.APP_URL || vercel[0];
  const trustedOrigins = [...new Set([baseURL, ...vercel].filter((origin): origin is string => Boolean(origin)))];
  return { baseURL, trustedOrigins };
}
