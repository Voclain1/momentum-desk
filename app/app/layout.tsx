import type { Metadata } from "next";
import { requireWorkspace } from "@/lib/auth/session";
import Link from "next/link";
import { Sidebar } from "./_components/sidebar";

export const metadata: Metadata = {
  title: "Workspace — MomentumDesk",
};

export default async function WorkspaceLayout({ children }: LayoutProps<"/app">) {
  const workspace = await requireWorkspace();
  return (
    <div className="app-shell">
      <Sidebar workspace={workspace} />
      <main className="content">
        {workspace.organization.deleteAfter ? (
          <p role="alert" className="settings-message error closing-banner">
            This workspace is closing. It and all its data will be deleted on{" "}
            {new Intl.DateTimeFormat(workspace.organization.locale, { dateStyle: "long", timeZone: workspace.organization.timezone }).format(workspace.organization.deleteAfter)}.
            Download everything from <Link href="/app/settings">Settings</Link> before then; an owner can cancel there.
          </p>
        ) : null}
        {children}
      </main>
    </div>
  );
}
