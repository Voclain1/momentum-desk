import type { Metadata } from "next";
import { requireWorkspace } from "@/lib/auth/session";
import { Sidebar } from "./_components/sidebar";

export const metadata: Metadata = {
  title: "Workspace — MomentumDesk",
};

export default async function WorkspaceLayout({ children }: LayoutProps<"/app">) {
  const workspace = await requireWorkspace();
  return (
    <div className="app-shell">
      <Sidebar workspace={workspace} />
      <main className="content">{children}</main>
    </div>
  );
}
