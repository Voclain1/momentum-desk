import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { invitationPath } from "@/lib/auth/paths";
import { requireUser } from "@/lib/auth/session";
import { FormMessage, Heading } from "../../_components/form";
import { AcceptInvitation, SendVerification, SwitchAccount } from "./invitation-actions";

export const metadata: Metadata = { title: "Invitation — MomentumDesk" };

const ROLE_LABELS: Record<string, string> = {
  owner: "an owner",
  admin: "an admin",
  sales: "a sales team member",
  finance: "a finance team member",
  member: "a member",
};

/** Better Auth's error code, if the call failed with one. */
function errorCode(error: unknown): string | undefined {
  return (error as { body?: { code?: string } })?.body?.code;
}

export default async function InvitationPage({ params }: PageProps<"/invite/[id]">) {
  const { id } = await params;
  const returnTo = invitationPath(id);
  const { user } = await requireUser(returnTo);

  // Better Auth checks the invitation is pending and unexpired, that it was
  // sent to this account's email, and that the email is confirmed.
  let invitation;
  try {
    invitation = await auth.api.getInvitation({ query: { id }, headers: await headers() });
  } catch (error) {
    const code = errorCode(error);
    if (code === "EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION") {
      return (
        <>
          <Heading title="Confirm your email first">
            To join a workspace, confirm that <strong>{user.email}</strong> is your address.
          </Heading>
          <SendVerification email={user.email} returnTo={returnTo} />
        </>
      );
    }
    if (code === "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION") {
      return (
        <>
          <Heading title="This invitation is for someone else">
            You are signed in as <strong>{user.email}</strong>. Sign in with the address the invitation was
            sent to.
          </Heading>
          <SwitchAccount returnTo={returnTo} />
        </>
      );
    }
    return (
      <>
        <Heading title="This invitation is no longer valid" />
        <FormMessage tone="error">
          It may have expired, been cancelled or already been used. Ask whoever invited you to send a new one.
        </FormMessage>
        <p className="mt-6 text-center text-sm">
          <Link href="/app" className="font-semibold text-[#167a62]">
            Go to MomentumDesk
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <Heading title={`Join ${invitation.organizationName}`}>
        {invitation.inviterEmail} invited you to join as {ROLE_LABELS[invitation.role] ?? invitation.role}.
      </Heading>
      <AcceptInvitation invitationId={invitation.id} />
    </>
  );
}
