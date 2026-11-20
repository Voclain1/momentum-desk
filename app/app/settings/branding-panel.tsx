"use client";

import { useActionState, useTransition, useState } from "react";
import type { BrandingState } from "./branding-actions";

type Action = (state: BrandingState, form: FormData) => Promise<BrandingState>;

function Note({ state }: { state: BrandingState }) {
  if (state.status === "saved") return <p role="status" className="settings-message saved">{state.message}</p>;
  if (state.status === "error") return <p role="alert" className="settings-message error">{state.message}</p>;
  return null;
}

/** Settings → Branding: the logo and accent colour on quotes, invoices, PDFs and emails. */
export function BrandingPanel({
  canEdit,
  name,
  logoUrl,
  accentColor,
  upload,
  remove,
  accent,
}: {
  canEdit: boolean;
  name: string;
  logoUrl: string | null;
  accentColor: string | null;
  upload: Action;
  remove: () => Promise<BrandingState>;
  accent: Action;
}) {
  const [uploadState, uploadAction, uploading] = useActionState(upload, { status: "idle" });
  const [accentState, accentAction, saving] = useActionState(accent, { status: "idle" });
  const [removeState, setRemoveState] = useState<BrandingState>({ status: "idle" });
  const [removing, startRemove] = useTransition();
  return (
    <section className="panel contacts-panel" aria-label="Branding">
      <div className="panel-heading">
        <div><h3>Branding</h3><p>Your logo and colour on quotes, invoices, their PDFs and emails.</p></div>
      </div>
      <div className="collection-panel">
        {/* eslint-disable-next-line @next/next/no-img-element -- the workspace's own stored logo */}
        {logoUrl ? <img className="quote-logo" src={logoUrl} alt={`${name} logo`} /> : <p className="form-hint">No logo yet: documents show your business name.</p>}
        {canEdit ? (
          <>
            <form action={uploadAction} className="contact-form" aria-label="Logo">
              <Note state={uploadState} />
              <label className="settings-field">
                <span>Logo (PNG or JPEG, up to 256 KB)</span>
                <input type="file" name="logo" accept="image/png,image/jpeg" required />
              </label>
              <div className="row-buttons">
                <button type="submit" className="new-button" disabled={uploading}>{uploading ? "Uploading…" : logoUrl ? "Replace logo" : "Upload logo"}</button>
                {logoUrl ? (
                  <button
                    type="button"
                    className="link-button"
                    disabled={removing}
                    onClick={() => startRemove(async () => {
                      if (window.confirm("Remove the logo from your documents?")) setRemoveState(await remove());
                    })}
                  >
                    Remove logo
                  </button>
                ) : null}
              </div>
              <Note state={removeState} />
            </form>
            <form action={accentAction} className="contact-form" aria-label="Accent colour">
              <Note state={accentState} />
              <label className="settings-field">
                <span>Accent colour for document titles</span>
                <input type="color" name="accentColor" defaultValue={accentColor ?? "#1f3a5f"} />
              </label>
              <div className="row-buttons">
                <button type="submit" className="new-button" disabled={saving}>Save colour</button>
                {accentColor ? <button type="submit" name="clear" value="1" className="link-button" disabled={saving}>Use no colour</button> : null}
              </div>
            </form>
          </>
        ) : null}
      </div>
    </section>
  );
}
