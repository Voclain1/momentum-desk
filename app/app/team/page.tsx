import type { Metadata } from "next";
import { invitationPath } from "@/lib/auth/paths";
import { listPendingInvitations, listTeam } from "@/lib/auth/team";
import { emailIsDelivered } from "@/lib/email";
import { parseEnv } from "@/lib/env";
import { requireTenant } from "@/lib/tenant/server";
import { TeamManager } from "./team-manager";

export const metadata: Metadata = { title: "Team — MomentumDesk" };

export default async function TeamPage() {
  const tenant = await requireTenant("workspace:read");
  const { organization, user } = tenant;
  const canManage = tenant.can("members:manage");
  const [members, invitations] = await Promise.all([
    listTeam(organization.id),
    canManage ? listPendingInvitations(organization.id) : Promise.resolve([]),
  ]);
  const date = new Intl.DateTimeFormat(organization.locale, { dateStyle: "medium", timeZone: organization.timezone });

  return (
    <>
      <header className="topbar">
        <div>
          <p>WORKSPACE</p>
          <h1>Team</h1>
        </div>
      </header>
      <TeamManager
        organizationId={organization.id}
        currentUserId={user.id}
        canManage={canManage}
        emailDelivered={emailIsDelivered(parseEnv(process.env))}
        // Only owners may hand out the owner role (Better Auth enforces it too).
        canAssignOwner={tenant.can("ownership:manage")}
        members={members.map((member) => ({ ...member, joinedAt: date.format(member.joinedAt) }))}
        invitations={invitations.map((invitation) => ({
          ...invitation,
          path: invitationPath(invitation.id),
          expiresAt: invitation.expiresAt ? date.format(invitation.expiresAt) : null,
        }))}
      />
    </>
  );
}
