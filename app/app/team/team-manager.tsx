"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient, authErrorMessage } from "@/lib/auth/client";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  sales: "Sales",
  finance: "Finance",
  member: "Member",
};
const ROLE_HINTS: Record<string, string> = {
  owner: "Everything, including deleting the workspace",
  admin: "Settings and team, everything except ownership",
  sales: "Customers, leads, pipeline and quotes",
  finance: "Customers, invoices, payments and collections",
  member: "Workspace summary only",
};
const roleLabel = (role: string) => role.split(",").map((part) => ROLE_LABELS[part.trim()] ?? part).join(", ");

type Role = "owner" | "admin" | "sales" | "finance" | "member";

interface Member {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  joinedAt: string;
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  expiresAt: string | null;
  invitedBy: string;
  path: string;
}

export function TeamManager({
  organizationId,
  currentUserId,
  canManage,
  canAssignOwner,
  emailDelivered,
  members,
  invitations,
}: {
  organizationId: string;
  currentUserId: string;
  canManage: boolean;
  canAssignOwner: boolean;
  /** Whether invitation emails are actually sent (Resend configured). */
  emailDelivered: boolean;
  members: Member[];
  invitations: Invitation[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const assignable: Role[] = canAssignOwner
    ? ["member", "sales", "finance", "admin", "owner"]
    : ["member", "sales", "finance", "admin"];

  /** Runs a Better Auth call, then reloads the server data on success. */
  async function run(work: () => Promise<{ error: { message?: string; status?: number } | null }>, done: string) {
    setBusy(true);
    setError("");
    setNotice("");
    const { error } = await work();
    setBusy(false);
    if (error) {
      setError(authErrorMessage(error));
      return false;
    }
    setNotice(done);
    router.refresh();
    return true;
  }

  async function invite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const email = String(data.get("email")).trim();
    const ok = await run(
      () => authClient.organization.inviteMember({ organizationId, email, role: String(data.get("role")) as Role }),
      emailDelivered
        ? `Invitation emailed to ${email}. You can also copy its link below.`
        : `Invitation created for ${email}. Copy its link below to share it.`,
    );
    if (ok) form.reset();
  }

  async function copyLink(invitation: Invitation) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${invitation.path}`);
      setNotice(`Link for ${invitation.email} copied.`);
    } catch {
      setError("Could not copy. Select the link and copy it manually.");
    }
  }

  return (
    <section className="team-page">
      {error ? (
        <p role="alert" className="settings-message error">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="settings-message saved">
          {notice}
        </p>
      ) : null}

      {canManage ? (
        <form onSubmit={invite} className="panel team-invite" aria-label="Invite a teammate">
          <h3>Invite a teammate</h3>
          <div>
            <label>
              <span>Email</span>
              <input name="email" type="email" required autoComplete="off" />
            </label>
            <label>
              <span>Role</span>
              <select name="role" defaultValue="member">
                {assignable.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]} · {ROLE_HINTS[role]}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="new-button" disabled={busy}>
              Invite
            </button>
          </div>
          <p>
            They must sign in with this email address and confirm it before they can join. Invitations
            expire after 7 days.
          </p>
        </form>
      ) : null}

      <div className="panel">
        <div className="panel-heading">
          <div>
            <h3>Members</h3>
            <p>{members.length === 1 ? "1 person" : `${members.length} people`} in this workspace</p>
          </div>
        </div>
        <table className="team-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Joined</th>
              {canManage ? <th aria-label="Actions" /> : null}
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const isSelf = member.userId === currentUserId;
              // Admins cannot change or remove owners; Better Auth refuses it anyway.
              const editable = canManage && !isSelf && (canAssignOwner || !member.role.split(",").includes("owner"));
              return (
                <tr key={member.id}>
                  <td>
                    <strong>
                      {member.name}
                      {isSelf ? " (you)" : ""}
                    </strong>
                    <small>{member.email}</small>
                  </td>
                  <td>
                    {editable ? (
                      <select
                        aria-label={`Role for ${member.name}`}
                        value={member.role}
                        disabled={busy}
                        onChange={(event) =>
                          run(
                            () =>
                              authClient.organization.updateMemberRole({
                                organizationId,
                                memberId: member.id,
                                role: event.target.value as Role,
                              }),
                            `${member.name} is now ${roleLabel(event.target.value)}.`,
                          )
                        }
                      >
                        {assignable.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      roleLabel(member.role)
                    )}
                  </td>
                  <td>{member.joinedAt}</td>
                  {canManage ? (
                    <td>
                      {editable ? (
                        <button
                          type="button"
                          className="link-button danger"
                          disabled={busy}
                          onClick={() => {
                            if (!window.confirm(`Remove ${member.name} from this workspace?`)) return;
                            run(
                              () => authClient.organization.removeMember({ organizationId, memberIdOrEmail: member.id }),
                              `${member.name} was removed.`,
                            );
                          }}
                        >
                          Remove
                        </button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canManage ? (
        <div className="panel">
          <div className="panel-heading">
            <div>
              <h3>Pending invitations</h3>
              <p>
                {emailDelivered
                  ? "Each invitee was emailed a link. You can also copy it to share directly."
                  : "Email delivery is not set up, so share each link directly."}
              </p>
            </div>
          </div>
          {invitations.length === 0 ? (
            <p className="team-empty">No pending invitations.</p>
          ) : (
            <table className="team-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Expires</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {invitations.map((invitation) => (
                  <tr key={invitation.id}>
                    <td>
                      <strong>{invitation.email}</strong>
                      <small>Invited by {invitation.invitedBy}</small>
                    </td>
                    <td>{roleLabel(invitation.role)}</td>
                    <td>{invitation.expiresAt ?? "—"}</td>
                    <td className="team-actions">
                      <button type="button" className="link-button" onClick={() => copyLink(invitation)}>
                        Copy link
                      </button>
                      <button
                        type="button"
                        className="link-button danger"
                        disabled={busy}
                        onClick={() =>
                          run(
                            () => authClient.organization.cancelInvitation({ invitationId: invitation.id }),
                            `Invitation for ${invitation.email} cancelled.`,
                          )
                        }
                      >
                        Cancel
                      </button>
                      <code className="team-link" data-invitation-link>
                        {invitation.path}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}
    </section>
  );
}
