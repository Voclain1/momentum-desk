import { AuthorizationError } from "@/lib/auth/authorization";
import { tenantData } from "@/lib/tenant";
import { requireTenant } from "@/lib/tenant/server";
import type { TenantData } from "@/lib/tenant/core";

/**
 * A CSV download for a route handler. Needs data:export plus read access to
 * the records; anything else is a 403 with no data.
 */
export async function csvDownload(
  readPermission: "customers:read" | "sales:read",
  name: string,
  build: (data: TenantData, organizationId: string) => Promise<string>,
): Promise<Response> {
  let tenant;
  try {
    tenant = await requireTenant("data:export");
    if (!tenant.can(readPermission)) throw new AuthorizationError(403);
  } catch (error) {
    if (error instanceof AuthorizationError) return new Response("Your role cannot export this data.", { status: error.status });
    throw error;
  }
  const csv = await build(tenantData, tenant.organization.id);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${tenant.organization.slug}-${name}-${date}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
