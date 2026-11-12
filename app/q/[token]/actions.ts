"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { EmailNotConfiguredError } from "@/lib/email";
import { emailSender } from "@/lib/email/server";
import { confirmAcceptance, type PublicResult, rejectQuote, requestAcceptanceCode, type Visitor } from "@/lib/quotes/public";
import { publicLinks, tenantData } from "@/lib/tenant";

/** The customer's answers on a public quote page. The token is the only credential. */

export type PublicState = { status: "idle" } | ({ status: "done" } & PublicResult);

export async function visitorFrom(): Promise<Visitor> {
  const h = await headers();
  return {
    ipAddress: h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null,
    userAgent: h.get("user-agent"),
  };
}

const deps = { data: tenantData, links: publicLinks, email: emailSender };

async function answer(token: string, work: (visitor: Visitor) => Promise<PublicResult>): Promise<PublicState> {
  try {
    const result = await work(await visitorFrom());
    if (result.ok) revalidatePath(`/q/${token}`);
    return { status: "done", ...result };
  } catch (error) {
    if (error instanceof EmailNotConfiguredError) {
      return { status: "done", ok: false, message: "We could not send the code because this business has not set up email yet. Contact them to accept." };
    }
    throw error;
  }
}

export async function requestCodeAction(token: string, _: PublicState, form: FormData): Promise<PublicState> {
  return answer(token, (visitor) =>
    requestAcceptanceCode(deps, token, { name: String(form.get("name") ?? ""), email: String(form.get("email") ?? "") || undefined }, visitor),
  );
}

export async function confirmCodeAction(token: string, _: PublicState, form: FormData): Promise<PublicState> {
  return answer(token, (visitor) => confirmAcceptance(deps, token, { code: String(form.get("code") ?? "") }, visitor));
}

export async function rejectAction(token: string, _: PublicState, form: FormData): Promise<PublicState> {
  return answer(token, (visitor) =>
    rejectQuote(deps, token, { name: String(form.get("name") ?? ""), reason: String(form.get("reason") ?? "") }, visitor),
  );
}
