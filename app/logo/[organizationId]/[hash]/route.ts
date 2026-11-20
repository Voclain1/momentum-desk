import { getBranding } from "@/lib/branding/service";
import { tenantData } from "@/lib/tenant";

/**
 * A workspace's logo, public by nature: it is printed on every document the
 * workspace sends. The URL names the logo's hash, so a new logo gets a new
 * URL and this one can be cached for good. Only the logo is read.
 */
export async function GET(_: Request, { params }: RouteContext<"/logo/[organizationId]/[hash]">) {
  const { organizationId, hash } = await params;
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(organizationId) || !/^[0-9a-f]{16}$/.test(hash)) return new Response("Not found", { status: 404 });
  const { logo } = await getBranding(tenantData, organizationId);
  if (!logo || logo.hash !== hash) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(logo.bytes), {
    headers: {
      "Content-Type": logo.type,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
