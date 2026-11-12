/** A PDF download. Private: never cached by shared caches. */
export function pdfResponse(bytes: Uint8Array, filename: string): Response {
  const safe = filename.replace(/[^A-Za-z0-9._-]+/g, "-");
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${safe}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}

export const quoteFilename = (quote: { number: string; revision: number }) =>
  `${quote.number}${quote.revision > 1 ? `-rev${quote.revision}` : ""}.pdf`;
