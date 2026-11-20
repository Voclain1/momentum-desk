import Link from "next/link";

/**
 * Terms and privacy drafts (decision D40). Bracketed placeholders are for the
 * owner and a lawyer to complete; the banner stays until they are reviewed.
 */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <main className="legal-page">
      <p role="note" className="settings-message error legal-draft">
        Draft for legal review. This text has not yet been reviewed by a lawyer; bracketed items are still to be completed.
      </p>
      <h1>{title}</h1>
      <p className="form-hint">Last updated {updated}. <Link href="/terms">Terms</Link> · <Link href="/privacy">Privacy</Link></p>
      {children}
    </main>
  );
}
