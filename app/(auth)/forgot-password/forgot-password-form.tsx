"use client";

import { useState } from "react";
import { authClient, authErrorMessage } from "@/lib/auth/client";
import { Field, FormMessage, SubmitButton } from "../_components/form";

export function ForgotPasswordForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email")).trim();
    setPending(true);
    setError("");
    const { error } = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    setPending(false);
    if (error) setError(authErrorMessage(error));
    else setSent(true);
  }

  if (sent) {
    // Same message whether or not the account exists, so the form does not
    // reveal who has an account.
    return (
      <FormMessage tone="success">
        If an account exists for that email, a reset link is on its way. It expires in one hour.
      </FormMessage>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <FormMessage tone="error">{error}</FormMessage>
      <Field label="Email" name="email" type="email" autoComplete="email" required />
      <SubmitButton pending={pending}>Send reset link</SubmitButton>
    </form>
  );
}
