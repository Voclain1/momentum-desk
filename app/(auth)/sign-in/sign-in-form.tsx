"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient, authErrorMessage } from "@/lib/auth/client";
import { Field, FormMessage, SubmitButton } from "../_components/form";

type Mode = "password" | "magic-link";

export function SignInForm({ next }: { next: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("password");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState("");

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email")).trim();
    setPending(true);
    setError("");

    if (mode === "magic-link") {
      const { error } = await authClient.signIn.magicLink({ email, callbackURL: next });
      setPending(false);
      if (error) setError(authErrorMessage(error));
      else setSentTo(email);
      return;
    }

    const { error } = await authClient.signIn.email({ email, password: String(form.get("password")) });
    if (error) {
      setError(error.status === 401 ? "Email or password is incorrect." : authErrorMessage(error));
      setPending(false);
      return;
    }
    router.push(next);
    router.refresh();
  }

  if (sentTo) {
    return (
      <FormMessage tone="success">
        We sent a sign-in link to <strong>{sentTo}</strong>. It works once and expires in 10 minutes.
      </FormMessage>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-2 rounded-lg bg-[#eef2f0] p-1 text-sm" role="tablist">
        {(["password", "magic-link"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={mode === option}
            onClick={() => {
              setMode(option);
              setError("");
            }}
            className={`rounded-md py-1.5 font-semibold ${mode === option ? "bg-white shadow-sm" : "text-[#718087]"}`}
          >
            {option === "password" ? "Password" : "Email me a link"}
          </button>
        ))}
      </div>
      <FormMessage tone="error">{error}</FormMessage>
      <Field label="Email" name="email" type="email" autoComplete="email" required />
      {mode === "password" ? (
        <>
          <Field
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
          <p className="-mt-2 text-right text-xs">
            <Link href="/forgot-password" className="font-semibold text-[#167a62]">
              Forgot password?
            </Link>
          </p>
        </>
      ) : null}
      <SubmitButton pending={pending}>
        {mode === "password" ? "Sign in" : "Send sign-in link"}
      </SubmitButton>
    </form>
  );
}
