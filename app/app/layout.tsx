import type { Metadata } from "next";
import { Sidebar } from "./_components/sidebar";

export const metadata: Metadata = {
  title: "Workspace — MomentumDesk",
};

export default function WorkspaceLayout({ children }: LayoutProps<"/app">) {
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="content">{children}</main>
    </div>
  );
}
