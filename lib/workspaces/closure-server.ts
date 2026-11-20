import { db } from "@/lib/db";
import { cancelClosure, requestClosure } from "./closure";

/** Server bindings of lib/workspaces/closure.ts for the app's actions. */
export const requestWorkspaceClosure = (actor: { organizationId: string; userId: string }) => requestClosure(db, actor);
export const cancelWorkspaceClosure = (actor: { organizationId: string; userId: string }) => cancelClosure(db, actor);

/** Owners' addresses, to tell every owner about a closure. */
export async function ownerEmails(organizationId: string) {
  const owners = await db.member.findMany({ where: { organizationId, role: "owner" }, include: { user: { select: { email: true } } } });
  return owners.map((o) => ({ userId: o.userId, email: o.user.email }));
}
