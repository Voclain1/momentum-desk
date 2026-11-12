import { pdfResponse, quoteFilename } from "@/lib/documents/pdf-response";
import { renderQuotePdf } from "@/lib/documents/quote-pdf";
import { emailSender } from "@/lib/email/server";
import { quoteForDownload } from "@/lib/quotes/public";
import { publicLinks, tenantData } from "@/lib/tenant";

/** The customer's copy, behind the same link as the page (decision D16). */
export async function GET(_: Request, { params }: RouteContext<"/q/[token]/pdf">) {
  const { token } = await params;
  const found = await quoteForDownload({ data: tenantData, links: publicLinks, email: emailSender }, token);
  if (!found) return new Response("Not found", { status: 404 });
  const bytes = await renderQuotePdf(found.quote, { seller: found.seller.name, locale: found.seller.locale });
  return pdfResponse(bytes, quoteFilename(found.quote));
}
