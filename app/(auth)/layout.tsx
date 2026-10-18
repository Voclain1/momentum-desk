import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col bg-[#102c27] px-4 py-8 text-[#d9e7e1]">
      <Link
        href="/"
        className="mx-auto flex items-center gap-2.5 text-xl font-bold tracking-tight text-white"
      >
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#2bb48c] font-serif italic">
          M
        </span>
        MomentumDesk
      </Link>
      <div className="mx-auto mt-10 w-full max-w-md rounded-xl bg-white p-6 text-[#172126] shadow-xl sm:p-8">
        {children}
      </div>
    </main>
  );
}
