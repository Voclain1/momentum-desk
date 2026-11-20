"use server";

import { revalidatePath } from "next/cache";
import { AuthorizationError } from "@/lib/auth/authorization";
import { emailSender, publicOrigin } from "@/lib/email/server";
import { requireTenant } from "@/lib/tenant/server";
import { cancelWorkspaceClosure, ownerEmails, requestWorkspaceClosure } from "@/lib/workspaces/closure-server";
import { headers } from "next/headers";

export type ClosureState = { status: "idle" } | { status: "saved"; message: string } | { status: "error"; message: string };

/** An owner asks to close the workspace; every owner is told by email. */
export async function requestClosureAction(_: ClosureState, form: FormData): Promise<ClosureState> {
  let tenant;
  try {
    tenant = await requireTenant("ownership:manage");
  } catch (error) {
    if (error instanceof AuthorizationError) return { status: "error", message: "Only owners can close the workspace." };
    throw error;
  }
  const { organization } = tenant;
  if (String(form.get("confirmation") ?? "").trim() !== organization.name) {
    return { status: "error", message: "Type the workspace's name exactly to confirm." };
  }
  const deleteAfter = await requestWorkspaceClosure({ organizationId: organization.id, userId: tenant.user.id });
  const h = await headers();
  const origin = publicOrigin(`${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "localhost"}`);
  const owners = await ownerEmails(organization.id);
  const when = new Intl.DateTimeFormat(organization.locale, { dateStyle: "long", timeZone: organization.timezone }).format(deleteAfter);
  for (const owner of owners) {
    await emailSender.send({
      to: owner.email,
      subject: `${organization.name} will be deleted on ${when}`,
      text: [
        `${tenant.user.name} asked to close the MomentumDesk workspace ${organization.name}.`,
        "",
        `On ${when} the workspace and all its data will be deleted. Until then it works as usual: download everything from Settings, or cancel the closure there.`,
        "",
        `Open Settings: ${new URL("/app/settings", origin).toString()}`,
      ].join("\n"),
      idempotencyKey: `closure-${organization.id}-${owner.userId}-${deleteAfter.toISOString()}`,
    }).catch(() => {});
  }
  revalidatePath("/app", "layout");
  return { status: "saved", message: `The workspace will be deleted on ${when}.` };
}

export async function cancelClosureAction(): Promise<ClosureState> {
  let tenant;
  try {
    tenant = await requireTenant("ownership:manage");
  } catch (error) {
    if (error instanceof AuthorizationError) return { status: "error", message: "Only owners can cancel the closure." };
    throw error;
  }
  await cancelWorkspaceClosure({ organizationId: tenant.organization.id, userId: tenant.user.id });
  revalidatePath("/app", "layout");
  return { status: "saved", message: "Closure cancelled. Nothing will be deleted." };
}
