import { AuthorizationError } from "@/lib/auth/authorization";
import { pdfResponse, quoteFilename } from "@/lib/documents/pdf-response";
import { renderQuotePdf } from "@/lib/documents/quote-pdf";
import { RecordNotFoundError } from "@/lib/errors";
import { getQuote } from "@/lib/quotes/service";
import { tenantData } from "@/lib/tenant";
import { requireTenant } from "@/lib/tenant/server";

/** Staff download of any revision, drafts included (marked as such). */
export async function GET(_: Request, { params }: RouteContext<"/app/quotes/[id]/pdf">) {
  let tenant;
  try {
    tenant = await requireTenant("quotes:read");
  } catch (error) {
    if (error instanceof AuthorizationError) return new Response("Your role cannot see quotes.", { status: error.status });
    throw error;
  }
  const { id } = await params;
  try {
    const quote = await getQuote(tenantData, tenant.organization.id, id);
    const bytes = await renderQuotePdf(quote, { seller: tenant.organization.name, locale: tenant.organization.locale });
    return pdfResponse(bytes, quoteFilename(quote));
  } catch (error) {
    if (error instanceof RecordNotFoundError) return new Response("Not found", { status: 404 });
    throw error;
  }
}
