import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins/magic-link";
import { organization } from "better-auth/plugins/organization";
import type { DbClient } from "@/lib/db/client";
import type { EmailSender } from "@/lib/email";
import { isValidSlug } from "@/lib/organizations/slug";
import { organizationSettingsSchema } from "@/lib/organizations/settings";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./constants";
import { ac, roles } from "./permissions";

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

export function createAuth({ db, email, secret, baseURL, rateLimit }: AuthConfig) {
  return betterAuth({
    appName: "MomentumDesk",
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
          async beforeUpdateOrganization({ organization }) {
            if (organization.slug !== undefined && !isValidSlug(organization.slug)) {
              invalidSettings([{ path: ["slug"], message: "must be lower-case words separated by hyphens" }]);
            }
            // Validate only the settings being changed.
            const changed = SETTINGS_FIELDS.filter((field) => organization[field] !== undefined);
            const mask = Object.fromEntries(changed.map((field) => [field, true])) as Partial<
              Record<(typeof SETTINGS_FIELDS)[number], true>
            >;
            const settings = organizationSettingsSchema.pick(mask).safeParse(organization);
            if (!settings.success) invalidSettings(settings.error.issues);
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
