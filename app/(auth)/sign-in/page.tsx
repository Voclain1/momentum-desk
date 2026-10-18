import type { Metadata } from "next";
import Link from "next/link";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { FormMessage, Heading } from "../_components/form";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in — MomentumDesk" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const params = await searchParams;
  const next = safeRedirectPath(typeof params.next === "string" ? params.next : null);
  const reset = params.reset === "1";
  return (
    <>
      <Heading title="Sign in">Welcome back to your revenue desk.</Heading>
      {reset ? (
        <div className="mb-4">
          <FormMessage tone="success">Your password was changed. Sign in with it now.</FormMessage>
        </div>
      ) : null}
      <SignInForm next={next} />
      <p className="mt-6 text-center text-sm text-[#718087]">
        New to MomentumDesk?{" "}
        <Link href="/sign-up" className="font-semibold text-[#167a62]">
          Create an account
        </Link>
      </p>
    </>
  );
}
