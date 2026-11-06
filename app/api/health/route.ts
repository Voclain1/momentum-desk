import { checkHealth } from "@/lib/observability/health";

export const dynamic = "force-dynamic";

/** GET /api/health: 200 when the app and its database are reachable, 503 otherwise. */
export async function GET() {
  const report = await checkHealth();
  return Response.json(report, {
    status: report.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
