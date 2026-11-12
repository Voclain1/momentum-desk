"use client";

import { useActionState } from "react";
import type { ImportState } from "./actions";

export function ImportForm({
  action,
  columns,
  kind,
}: {
  action: (state: ImportState, form: FormData) => Promise<ImportState>;
  columns: string[];
  kind: string;
}) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  const template = `data:text/csv;charset=utf-8,${encodeURIComponent(columns.join(",") + "\r\n")}`;
  return (
    <form action={formAction} className="settings-form" aria-label={`Import ${kind}`}>
      {state.status === "saved" ? <p role="status" className="settings-message saved">{state.message}</p> : null}
      {state.status === "error" ? <p role="alert" className="settings-message error">{state.message}</p> : null}
      <fieldset disabled={pending}>
        <label className="settings-field">
          <span>CSV file</span>
          <input type="file" name="file" accept=".csv,text/csv" required />
        </label>
        <div className="row-buttons">
          <button type="submit" className="new-button">{pending ? "Importing…" : "Import"}</button>
          <a href={template} download={`${kind}-template.csv`} className="link-button">Download a template</a>
        </div>
      </fieldset>
      {state.status === "error" && state.errors?.length ? (
        <table className="import-errors" aria-label="Rows to fix">
          <thead>
            <tr><th>Line</th><th>Column</th><th>Problem</th></tr>
          </thead>
          <tbody>
            {state.errors.map((error, index) => (
              <tr key={index}>
                <td>{error.line}</td>
                <td>{error.field}</td>
                <td>{error.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </form>
  );
}
