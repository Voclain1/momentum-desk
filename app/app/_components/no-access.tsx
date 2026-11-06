/** Shown instead of a page the member's role does not allow (docs/authorization.md). */
export function NoAccess({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <>
      <header className="topbar">
        <div>
          <p>WORKSPACE</p>
          <h1>{title}</h1>
        </div>
      </header>
      <section className="panel no-access" role="note">
        <strong>Your role does not include access to this page.</strong>
        <p>{children ?? "Ask an owner or admin of this workspace if you need it."}</p>
      </section>
    </>
  );
}
