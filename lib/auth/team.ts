import { db } from "@/lib/db";

/**
 * Members and pending invitations of one workspace, for the team page.
 * Callers pass the organization from requireTenant(), never from the request,
 * and decide by permission whether to ask for invitations.
 */

export interface TeamMember {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  joinedAt: Date;
}

export interface PendingInvitation {
  id: string;
  email: string;
  role: string;
  expiresAt: Date | null;
  invitedBy: string;
}

export async function listTeam(organizationId: string): Promise<TeamMember[]> {
  const members = await db.member.findMany({
    where: { organizationId },
    include: { user: { select: { name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
  return members.map((member) => ({
    id: member.id,
    userId: member.userId,
    name: member.user.name,
    email: member.user.email,
    role: member.role,
    joinedAt: member.createdAt,
  }));
}

export async function listPendingInvitations(organizationId: string): Promise<PendingInvitation[]> {
  const invitations = await db.invitation.findMany({
    where: { organizationId, status: "pending", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    include: { inviter: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return invitations.map((invitation) => ({
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    expiresAt: invitation.expiresAt,
    invitedBy: invitation.inviter.name,
  }));
}
