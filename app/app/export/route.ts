import { AuthorizationError } from "@/lib/auth/authorization";
import { tenantData } from "@/lib/tenant";
import { requireTenant } from "@/lib/tenant/server";
import { exportWorkspace } from "@/lib/transfer/workspace-export";

/** GET /app/export: the whole workspace as a ZIP (owners and admins). */
export async function GET() {
  let tenant;
  try {
    tenant = await requireTenant("data:export");
  } catch (error) {
    if (error instanceof AuthorizationError) return new Response("Your role cannot export this workspace.", { status: error.status });
    throw error;
  }
  const { organization } = tenant;
  const zip = await exportWorkspace(tenantData, { organizationId: organization.id, userId: tenant.user.id }, { name: organization.name, locale: organization.locale });
  const date = new Date().toISOString().slice(0, 10);
  return new Response(Buffer.from(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${organization.slug}-export-${date}.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
}
