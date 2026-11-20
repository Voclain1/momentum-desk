"use server";

import { rateLimit } from "@/lib/security/server";

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
  if (!(await rateLimit("checkout")).allowed) return { status: "error", message: "Too many payment attempts from your connection. Wait a few minutes and try again." };
  const h = await headers();
  const origin = publicOrigin(`${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "localhost"}`);
  const result = await startCheckout(onlineDeps, token, { connectionId, email: String(form.get("email") ?? "") || undefined }, { origin });
  if (!result.ok) return { status: "error", message: result.message };
  redirect(result.url);
}

export type StopState = { status: "idle" } | { status: "done" } | { status: "error" };

/** The customer stops payment reminders from their invoice link (spec §7.8). */
export async function stopRemindersAction(token: string): Promise<StopState> {
  if (!(await rateLimit("stopReminders")).allowed) return { status: "error" };
  return (await optOutFromInvoiceLink({ data: tenantData, links: publicLinks }, token)) ? { status: "done" } : { status: "error" };
}
