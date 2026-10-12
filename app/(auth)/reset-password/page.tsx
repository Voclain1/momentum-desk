import type { Metadata } from "next";
import Link from "next/link";
import { FormMessage, Heading } from "../_components/form";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Choose a new password — MomentumDesk" };

export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const { token, error } = await searchParams;
  if (typeof token !== "string" || error) {
    return (
      <>
        <Heading title="This link has expired" />
        <FormMessage tone="error">
          Password reset links work once and expire after an hour. Request a new one.
        </FormMessage>
        <p className="mt-6 text-center text-sm">
          <Link href="/forgot-password" className="font-semibold text-[#167a62]">
            Send a new link
          </Link>
        </p>
      </>
    );
  }
  return (
    <>
      <Heading title="Choose a new password">You will be signed out everywhere else.</Heading>
      <ResetPasswordForm token={token} />
    </>
  );
}
