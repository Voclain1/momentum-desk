import { checkHealth } from "@/lib/observability/health";

export const dynamic = "force-dynamic";

/**
 * GET /api/health: 200 when the app and its database are reachable, 503
 * otherwise. With ?strict=1 (for uptime monitors), also 503 when no
 * background worker has been seen in the last five minutes.
 */
export async function GET(request: Request) {
  const report = await checkHealth(undefined, { strict: new URL(request.url).searchParams.get("strict") === "1" });
  return Response.json(report, {
    status: report.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
