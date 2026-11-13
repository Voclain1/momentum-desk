import { AuthorizationError } from "@/lib/auth/authorization";
import { renderInvoicePdf } from "@/lib/documents/invoice-pdf";
import { pdfResponse } from "@/lib/documents/pdf-response";
import { RecordNotFoundError } from "@/lib/errors";
import { getInvoice } from "@/lib/invoices/service";
import { tenantData } from "@/lib/tenant";
import { requireTenant } from "@/lib/tenant/server";

/** Staff download of an invoice, drafts and void ones included (stamped). */
export async function GET(_: Request, { params }: RouteContext<"/app/invoices/[id]/pdf">) {
  let tenant;
  try {
    tenant = await requireTenant("invoices:read");
  } catch (error) {
    if (error instanceof AuthorizationError) return new Response("Your role cannot see invoices.", { status: error.status });
    throw error;
  }
  const { id } = await params;
  try {
    const invoice = await getInvoice(tenantData, tenant.organization.id, id);
    const bytes = await renderInvoicePdf(invoice, { seller: tenant.organization.name, locale: tenant.organization.locale });
    return pdfResponse(bytes, `${invoice.number ?? "draft-invoice"}.pdf`);
  } catch (error) {
    if (error instanceof RecordNotFoundError) return new Response("Not found", { status: 404 });
    throw error;
  }
}
