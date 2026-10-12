"use client";

import type { InputHTMLAttributes, ReactNode } from "react";

export function Field({
  label,
  hint,
  ...input
}: { label: string; hint?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold">{label}</span>
      <input
        {...input}
        className="w-full rounded-lg border border-[#d5ddd9] px-3 py-2.5 text-sm outline-none focus:border-[#167a62] focus:ring-2 focus:ring-[#167a62]/20"
      />
      {hint ? <span className="mt-1 block text-xs text-[#718087]">{hint}</span> : null}
    </label>
  );
}

export function SubmitButton({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg bg-[#167a62] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#13695a] disabled:opacity-60"
    >
      {pending ? "Please wait…" : children}
    </button>
  );
}

export function FormMessage({ tone, children }: { tone: "error" | "success"; children: ReactNode }) {
  if (!children) return null;
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={
        tone === "error"
          ? "rounded-lg bg-[#fff1ef] px-3 py-2 text-sm text-[#a5413a]"
          : "rounded-lg bg-[#e9f6f1] px-3 py-2 text-sm text-[#1d6b55]"
      }
    >
      {children}
    </p>
  );
}

export function Heading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      {children ? <p className="mt-1.5 text-sm text-[#718087]">{children}</p> : null}
    </div>
  );
}
