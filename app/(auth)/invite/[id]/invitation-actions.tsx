"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient, authErrorMessage } from "@/lib/auth/client";
import { FormMessage } from "../../_components/form";

const primary =
  "w-full rounded-lg bg-[#167a62] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#13695a] disabled:opacity-60";
const secondary =
  "w-full rounded-lg border border-[#d5ddd9] px-4 py-2.5 text-sm font-semibold text-[#172126] hover:bg-[#f6f7f3] disabled:opacity-60";

export function AcceptInvitation({ invitationId }: { invitationId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function respond(accept: boolean) {
    setPending(true);
    setError("");
    const { error } = accept
      ? await authClient.organization.acceptInvitation({ invitationId })
      : await authClient.organization.rejectInvitation({ invitationId });
    if (error) {
      setError(authErrorMessage(error));
      setPending(false);
      return;
    }
    // Accepting makes the new workspace the active one.
    router.push(accept ? "/app" : "/onboarding");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <FormMessage tone="error">{error}</FormMessage>
      <button type="button" className={primary} disabled={pending} onClick={() => respond(true)}>
        Accept and join
      </button>
      <button type="button" className={secondary} disabled={pending} onClick={() => respond(false)}>
        Decline
      </button>
    </div>
  );
}

export function SendVerification({ email, returnTo }: { email: string; returnTo: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function send() {
    setPending(true);
    setError("");
    const { error } = await authClient.sendVerificationEmail({ email, callbackURL: returnTo });
    setPending(false);
    if (error) setError(authErrorMessage(error));
    else setSent(true);
  }

  if (sent) {
    return (
      <FormMessage tone="success">
        Check your inbox for a confirmation link. It brings you back here.
      </FormMessage>
    );
  }
  return (
    <div className="space-y-3">
      <FormMessage tone="error">{error}</FormMessage>
      <button type="button" className={primary} disabled={pending} onClick={send}>
        Send confirmation email
      </button>
    </div>
  );
}

export function SwitchAccount({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function switchAccount() {
    setPending(true);
    await authClient.signOut();
    router.push(`/sign-in?next=${encodeURIComponent(returnTo)}`);
    router.refresh();
  }

  return (
    <button type="button" className={primary} disabled={pending} onClick={switchAccount}>
      Sign out and use another account
    </button>
  );
}
