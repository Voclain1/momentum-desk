import { renderInvoicePdf } from "@/lib/documents/invoice-pdf";
import { pdfResponse } from "@/lib/documents/pdf-response";
import { invoiceForDownload } from "@/lib/invoices/public";
import { publicLinks, tenantData } from "@/lib/tenant";

/** The customer's copy, behind the same link as the page. */
export async function GET(_: Request, { params }: RouteContext<"/i/[token]/pdf">) {
  const { token } = await params;
  const found = await invoiceForDownload({ data: tenantData, links: publicLinks }, token);
  if (!found) return new Response("Not found", { status: 404 });
  const bytes = await renderInvoicePdf(found.invoice, { seller: found.seller.name, locale: found.seller.locale });
  return pdfResponse(bytes, `${found.invoice.number}.pdf`);
}
