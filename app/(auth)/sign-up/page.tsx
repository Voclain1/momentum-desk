import type { Metadata } from "next";
import Link from "next/link";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { Heading } from "../_components/form";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Create your account — MomentumDesk" };

export default async function SignUpPage({ searchParams }: PageProps<"/sign-up">) {
  const params = await searchParams;
  const requested = typeof params.next === "string" ? params.next : null;
  // New users go on to create a workspace unless they came from an invitation.
  const next = safeRedirectPath(requested, "/onboarding");
  const invited = next.startsWith("/invite/");
  return (
    <>
      <Heading title="Create your account">
        {invited ? "Then accept your invitation." : "Then set up your workspace in a minute."}
      </Heading>
      <SignUpForm next={next} />
      <p className="mt-6 text-center text-sm text-[#718087]">
        Already have an account?{" "}
        <Link
          href={requested ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in"}
          className="font-semibold text-[#167a62]"
        >
          Sign in
        </Link>
      </p>
    </>
  );
}
