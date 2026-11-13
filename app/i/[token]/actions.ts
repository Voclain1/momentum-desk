"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { publicOrigin } from "@/lib/email/server";
import { startCheckout } from "@/lib/payments/online";
import { onlineDeps } from "@/lib/payments/server";
import { optOutFromInvoiceLink } from "@/lib/reminders/service";
import { publicLinks, tenantData } from "@/lib/tenant";

export type PayState = { status: "idle" } | { status: "error"; message: string };

/** Starts the provider's checkout for what is owed, then sends the customer there. */
export async function payAction(token: string, connectionId: string, _: PayState, form: FormData): Promise<PayState> {
  const h = await headers();
  const origin = publicOrigin(`${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "localhost"}`);
  const result = await startCheckout(onlineDeps, token, { connectionId, email: String(form.get("email") ?? "") || undefined }, { origin });
  if (!result.ok) return { status: "error", message: result.message };
  redirect(result.url);
}

export type StopState = { status: "idle" } | { status: "done" } | { status: "error" };

/** The customer stops payment reminders from their invoice link (spec §7.8). */
export async function stopRemindersAction(token: string): Promise<StopState> {
  return (await optOutFromInvoiceLink({ data: tenantData, links: publicLinks }, token)) ? { status: "done" } : { status: "error" };
}
