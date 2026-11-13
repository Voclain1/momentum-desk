import { handleWebhook } from "@/lib/payments/online";
import { onlineDeps } from "@/lib/payments/server";
import { publicLinks } from "@/lib/tenant";

/**
 * Payment provider webhooks, one URL per workspace connection (decision
 * D36). The raw body is read as-is for the signature check; the provider's
 * API is then asked what actually happened. 200 for anything handled or
 * repeated, 400 for a bad signature, 503 so the provider retries later.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/webhooks/[provider]/[connectionId]">) {
  const { provider, connectionId } = await params;
  const rawBody = await request.text();
  if (rawBody.length > 512 * 1024) return new Response("Too large", { status: 413 });
  const result = await handleWebhook(onlineDeps, provider, connectionId, rawBody, request.headers, (id) => publicLinks.organizationTimezone(id));
  return Response.json({ received: result.status === 200 }, { status: result.status });
}
