import type { Metadata } from "next";
import Link from "next/link";
import { Heading } from "../_components/form";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Create your account — MomentumDesk" };

export default function SignUpPage() {
  return (
    <>
      <Heading title="Create your account">Then set up your workspace in a minute.</Heading>
      <SignUpForm />
      <p className="mt-6 text-center text-sm text-[#718087]">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-semibold text-[#167a62]">
          Sign in
        </Link>
      </p>
    </>
  );
}
