import type { Metadata } from "next";
import Link from "next/link";
import { CUSTOMER_COLUMNS, LEAD_COLUMNS, MAX_IMPORT_ROWS } from "@/lib/transfer/service";
import { requireTenant } from "@/lib/tenant/server";
import { NoAccess } from "../_components/no-access";
import { importAction, type ImportKind } from "./actions";
import { ImportForm } from "./import-form";

export const metadata: Metadata = { title: "Import — MomentumDesk" };

export default async function ImportPage({ searchParams }: PageProps<"/app/import">) {
  const kind: ImportKind = (await searchParams).type === "leads" ? "leads" : "customers";
  const tenant = await requireTenant("workspace:read");
  const title = kind === "customers" ? "Import customers" : "Import leads";
  if (!tenant.can("data:export") || !tenant.can(kind === "customers" ? "customers:write" : "sales:write")) {
    return <NoAccess title={title}>Owners and admins can import data.</NoAccess>;
  }
  const columns = kind === "customers" ? CUSTOMER_COLUMNS : LEAD_COLUMNS;

  return (
    <>
      <header className="topbar">
        <div>
          <p>
            <Link href={`/app/${kind}`} className="crumb">{kind.toUpperCase()}</Link> · IMPORT
          </p>
          <h1>{title}</h1>
        </div>
      </header>
      <section className="settings-page">
        <div className="panel settings-panel">
          <div className="import-help">
            <p>
              Upload a CSV file with a header row, up to {MAX_IMPORT_ROWS} rows and 1 MB. Columns can be in any
              order and any may be left out except{" "}
              {kind === "customers" ? <code>displayName</code> : <><code>contactName</code> or <code>companyName</code></>}.
              Every row is checked first: if any row has a problem, nothing is imported.
            </p>
            <p>
              Columns: {columns.map((column, index) => <span key={column}>{index ? ", " : ""}<code>{column}</code></span>)}.
              {kind === "customers"
                ? " type is organization (the default) or person."
                : " stage is a stage name (blank for the first); estimatedValue uses a dot for decimals, with its currency."}{" "}
              Separate tags with commas.
            </p>
          </div>
          <ImportForm action={importAction.bind(null, kind)} columns={[...columns]} kind={kind} />
        </div>
      </section>
    </>
  );
}
