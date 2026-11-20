import { rateLimit } from "@/lib/security/server";
import { pdfSeller } from "@/lib/branding/service";
import { renderInvoicePdf } from "@/lib/documents/invoice-pdf";
import { pdfResponse } from "@/lib/documents/pdf-response";
import { invoiceForDownload } from "@/lib/invoices/public";
import { publicLinks, tenantData } from "@/lib/tenant";

/** The customer's copy, behind the same link as the page. */
export async function GET(_: Request, { params }: RouteContext<"/i/[token]/pdf">) {
  const { token } = await params;
  const limited = await rateLimit("documentView");
  if (!limited.allowed) return new Response("Too many requests", { status: 429, headers: { "Retry-After": String(limited.retryAfter) } });
  const found = await invoiceForDownload({ data: tenantData, links: publicLinks }, token);
  if (!found) return new Response("Not found", { status: 404 });
  const bytes = await renderInvoicePdf(found.invoice, await pdfSeller(tenantData, found.invoice.organizationId, found.seller));
  return pdfResponse(bytes, `${found.invoice.number}.pdf`);
}
