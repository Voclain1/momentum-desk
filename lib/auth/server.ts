import { tryGetCurrentAuthEndpointContext } from "@better-auth/core/context";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins/magic-link";
import { organization } from "better-auth/plugins/organization";
import { type AuditEntry, recordAudit } from "@/lib/audit";
import type { DbClient } from "@/lib/db/client";
import type { EmailSender } from "@/lib/email";
import { isValidSlug } from "@/lib/organizations/slug";
import { organizationSettingsSchema } from "@/lib/organizations/settings";
import { createTenantDb } from "@/lib/tenant/core";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./constants";
import { ac, roles } from "./permissions";
import { invitationPath } from "./paths";

export interface AuthConfig {
  db: DbClient;
  email: EmailSender;
  secret: string;
  /** Public origin, e.g. https://momentumdesk.app. Used to build emailed links. */
  baseURL?: string;
  /** Rate-limit auth endpoints. On by default in production. */
  rateLimit?: boolean;
}

const SETTINGS_FIELDS = [
  "baseCurrency",
  "countryCode",
  "locale",
  "timezone",
  "defaultLanguage",
  "defaultInvoiceCurrency",
] as const;

function invalidSettings(issues: { path: PropertyKey[]; message: string }[]): never {
  throw new APIError("BAD_REQUEST", {
    message: issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
  });
}

/** The signed-in user making the current auth request, if any. */
function currentActorId(): string | null {
  return tryGetCurrentAuthEndpointContext()?.context.session?.user.id ?? null;
}

/** Snapshot of an organization's name, slug and settings for the audit log. */
function organizationSnapshot(organization: Record<string, unknown>) {
  const snapshot: Record<string, string | null> = {};
  for (const field of ["name", "slug", ...SETTINGS_FIELDS] as const) {
    const value = organization[field];
    snapshot[field] = typeof value === "string" ? value : null;
  }
  return snapshot;
}

export const INVITATION_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60;

export function createAuth({ db, email, secret, baseURL, rateLimit }: AuthConfig) {
  const audit = (organizationId: string, entry: AuditEntry) =>
    recordAudit(createTenantDb(db, organizationId), entry);

  return betterAuth({
    appName: "MomentumDesk",
    // Replaced by lib/workspaces/settings-service.ts.
    disabledPaths: ["/organization/update"],
    baseURL,
    secret,
    database: prismaAdapter(db, { provider: "postgresql" }),
    rateLimit: {
      ...(rateLimit === undefined ? {} : { enabled: rateLimit }),
      // In-memory counters are per instance on serverless hosting.
      storage: "database",
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      // Email verification is not required to sign in while no email provider
      // is configured (D17). Invitations still require a verified address.
      requireEmailVerification: false,
      revokeSessionsOnPasswordReset: true,
      async sendResetPassword({ user, url }) {
        await email.send({
          to: user.email,
          subject: "Reset your MomentumDesk password",
          text: `Use this link to choose a new password. It expires in one hour.\n\n${url}\n\nIf you did not ask for this, you can ignore this email.`,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      async sendVerificationEmail({ user, url }) {
        // Sign-up must not fail just because verification email is unavailable.
        try {
          await email.send({
            to: user.email,
            subject: "Confirm your email for MomentumDesk",
            text: `Confirm your email address:\n\n${url}`,
          });
        } catch (error) {
          console.error("Could not send verification email", error);
        }
      },
    },
    plugins: [
      organization({
        ac,
        roles,
        creatorRole: "owner",
        allowUserToCreateOrganization: true,
        // An unverified account must not accept an invitation sent to that
        // address: anyone can sign up with someone else's email.
        requireEmailVerificationOnInvitation: true,
        invitationExpiresIn: INVITATION_EXPIRES_IN_SECONDS,
        // Inviting the same address again replaces the old link.
        cancelPendingInvitationsOnReInvite: true,
        async sendInvitationEmail({ id, email: to, role, organization, inviter }, request) {
          const origin = baseURL ?? (request ? new URL(request.url).origin : "");
          // The invitation already exists; managers can also copy its link from
          // the team page, so a missing email provider (D17) must not fail it.
          try {
            await email.send({
              to,
              subject: `${inviter.user.name} invited you to ${organization.name} on MomentumDesk`,
              text: `${inviter.user.name} invited you to join ${organization.name} as ${role}.\n\nAccept the invitation (expires in 7 days):\n\n${origin}${invitationPath(id)}\n\nIf you were not expecting this, you can ignore this email.`,
            });
          } catch (error) {
            console.error("Could not send invitation email", error);
          }
        },
        schema: {
          organization: {
            additionalFields: {
              baseCurrency: { type: "string", required: true },
              countryCode: { type: "string", required: true },
              locale: { type: "string", required: true },
              timezone: { type: "string", required: true },
              defaultLanguage: { type: "string", required: true },
              defaultInvoiceCurrency: { type: "string", required: false },
            },
          },
        },
        organizationHooks: {
          async beforeCreateOrganization({ organization }) {
            if (!organization.slug || !isValidSlug(organization.slug)) {
              invalidSettings([{ path: ["slug"], message: "must be lower-case words separated by hyphens" }]);
            }
            const settings = organizationSettingsSchema.safeParse(
              Object.fromEntries(SETTINGS_FIELDS.map((field) => [field, organization[field]])),
            );
            if (!settings.success) invalidSettings(settings.error.issues);
            return { data: { ...organization, ...settings.data } };
          },
          // Workspace name and settings change only through
          // lib/workspaces/settings-service.ts (permission re-check, version
          // check and audit in one transaction). The HTTP endpoint is also
          // disabled; this refuses server-side calls.
          async beforeUpdateOrganization() {
            throw new APIError("FORBIDDEN", {
              message: "Workspace settings are changed through the settings page.",
            });
          },
          // Audit trail. A failure to record propagates, so it is never silent.
          async afterCreateOrganization({ organization, user }) {
            await audit(organization.id, {
              action: "organization.created",
              actorUserId: user.id,
              targetType: "organization",
              targetId: organization.id,
              metadata: organizationSnapshot(organization),
            });
          },
          async afterAddMember({ member, organization }) {
            await audit(organization.id, {
              action: "member.added",
              actorUserId: currentActorId(),
              targetType: "member",
              targetId: member.id,
              metadata: { userId: member.userId, role: member.role },
            });
          },
          async afterUpdateMemberRole({ member, previousRole, organization }) {
            await audit(organization.id, {
              action: "member.role_updated",
              actorUserId: currentActorId(),
              targetType: "member",
              targetId: member.id,
              metadata: { userId: member.userId, from: previousRole, to: member.role },
            });
          },
          async afterRemoveMember({ member, organization }) {
            await audit(organization.id, {
              action: "member.removed",
              actorUserId: currentActorId(),
              targetType: "member",
              targetId: member.id,
              metadata: { userId: member.userId, role: member.role },
            });
          },
          async afterCreateInvitation({ invitation, inviter, organization }) {
            await audit(organization.id, {
              action: "invitation.created",
              actorUserId: inviter.id,
              targetType: "invitation",
              targetId: invitation.id,
              // No email address: the invitation id links to it while it exists.
              metadata: { role: invitation.role },
            });
          },
          async afterCancelInvitation({ invitation, cancelledBy, organization }) {
            await audit(organization.id, {
              action: "invitation.canceled",
              actorUserId: cancelledBy.id,
              targetType: "invitation",
              targetId: invitation.id,
            });
          },
          async afterAcceptInvitation({ invitation, member, user, organization }) {
            await audit(organization.id, {
              action: "invitation.accepted",
              actorUserId: user.id,
              targetType: "invitation",
              targetId: invitation.id,
              metadata: { memberId: member.id, role: member.role },
            });
          },
          async afterRejectInvitation({ invitation, user, organization }) {
            await audit(organization.id, {
              action: "invitation.rejected",
              actorUserId: user.id,
              targetType: "invitation",
              targetId: invitation.id,
            });
          },
        },
      }),
      magicLink({
        expiresIn: 10 * 60,
        storeToken: "hashed",
        async sendMagicLink({ email: to, url }) {
          await email.send({
            to,
            subject: "Your MomentumDesk sign-in link",
            text: `Use this link to sign in. It expires in 10 minutes and works once.\n\n${url}\n\nIf you did not ask for this, you can ignore this email.`,
          });
        },
      }),
      // Must be last: lets server actions set auth cookies.
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
