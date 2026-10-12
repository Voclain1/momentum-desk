import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/lib/db";
import { auth } from "./index";
import type { Role } from "./permissions";

/**
 * Server-side session checks (the data access layer from the Next.js
 * authentication guide). Every protected page, server action and route
 * handler calls one of these; the proxy's cookie check is only a fast
 * redirect, never the security boundary.
 */

/** The current session, read and validated against the database once per request. */
export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));

/** The signed-in user, or a redirect to sign-in. */
export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return session;
}

export interface Workspace {
  user: { id: string; name: string; email: string };
  organization: {
    id: string;
    name: string;
    slug: string;
    baseCurrency: string;
    countryCode: string;
    locale: string;
    timezone: string;
    defaultLanguage: string;
    defaultInvoiceCurrency: string | null;
  };
  role: Role;
}

/**
 * The signed-in user and the workspace they are working in, with their role.
 * Membership is re-read from the database: the session's active organization
 * id is only a preference and is never trusted on its own. A user without a
 * workspace is sent to onboarding.
 */
export const requireWorkspace = cache(async (): Promise<Workspace> => {
  const { user, session } = await requireUser();
  const memberships = await db.member.findMany({
    where: { userId: user.id },
    include: { organization: true },
    orderBy: { createdAt: "asc" },
  });
  if (memberships.length === 0) redirect("/onboarding");

  const membership =
    memberships.find((m) => m.organizationId === session.activeOrganizationId) ?? memberships[0];
  if (membership.organizationId !== session.activeOrganizationId) {
    // Remember the fallback so the choice is stable across requests.
    await db.session.update({
      where: { id: session.id },
      data: { activeOrganizationId: membership.organizationId },
    });
  }

  const { organization } = membership;
  return {
    user: { id: user.id, name: user.name, email: user.email },
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      baseCurrency: organization.baseCurrency,
      countryCode: organization.countryCode,
      locale: organization.locale,
      timezone: organization.timezone,
      defaultLanguage: organization.defaultLanguage,
      defaultInvoiceCurrency: organization.defaultInvoiceCurrency,
    },
    role: membership.role as Role,
  };
});
