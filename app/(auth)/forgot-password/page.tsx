import type { Metadata } from "next";
import Link from "next/link";
import { Heading } from "../_components/form";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Reset your password — MomentumDesk" };

export default function ForgotPasswordPage() {
  return (
    <>
      <Heading title="Reset your password">
        Enter your email and we will send you a link to choose a new one.
      </Heading>
      <ForgotPasswordForm />
      <p className="mt-6 text-center text-sm">
        <Link href="/sign-in" className="font-semibold text-[#167a62]">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
