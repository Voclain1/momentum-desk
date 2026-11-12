import type { Metadata } from "next";
import Link from "next/link";
import { listCustomers, SORTS, type CustomerQuery, type CustomerSort } from "@/lib/customers/service";
import { tenantData } from "@/lib/tenant";
import { requireTenant } from "@/lib/tenant/server";
import { NoAccess } from "../_components/no-access";

export const metadata: Metadata = { title: "Customers — MomentumDesk" };

const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

export default async function CustomersPage({ searchParams }: PageProps<"/app/customers">) {
  const tenant = await requireTenant("workspace:read");
  if (!tenant.can("customers:read")) return <NoAccess title="Customers" />;

  const params = await searchParams;
  const query: CustomerQuery = {
    q: one(params.q),
    type: one(params.type) === "person" || one(params.type) === "organization" ? (one(params.type) as CustomerQuery["type"]) : undefined,
    archived: one(params.archived) === "1",
    sort: SORTS.includes(one(params.sort) as CustomerSort) ? (one(params.sort) as CustomerSort) : "name",
    page: Number(one(params.page) ?? 1),
  };
  const { items, total, page, pageCount } = await listCustomers(tenantData, tenant.organization.id, query);

  const href = (changes: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams();
    const merged = { q: query.q, type: query.type, archived: query.archived ? "1" : undefined, sort: query.sort, page, ...changes };
    for (const [key, value] of Object.entries(merged)) {
      if (value !== undefined && value !== "" && !(key === "sort" && value === "name") && !(key === "page" && value === 1)) {
        next.set(key, String(value));
      }
    }
    const search = next.toString();
    return search ? `/app/customers?${search}` : "/app/customers";
  };

  return (
    <>
      <header className="topbar">
        <div>
          <p>CUSTOMERS</p>
          <h1>{query.archived ? "Archived customers" : "Customers"}</h1>
        </div>
        <div className="header-actions">
          {tenant.can("data:export") ? (
            <>
              {/* A file download, not a page: a plain link. */}
              <a href="/app/customers/export" className="icon-button text-button link-as-button" download>Export</a>
              {tenant.can("customers:write") ? (
                <Link href="/app/import?type=customers" className="icon-button text-button link-as-button">Import</Link>
              ) : null}
            </>
          ) : null}
          {tenant.can("customers:write") ? (
            <Link href="/app/customers/new" className="new-button link-as-button">
              <span aria-hidden>＋</span> New customer
            </Link>
          ) : null}
        </div>
      </header>

      <form className="list-filters" role="search" action="/app/customers">
        <input type="search" name="q" defaultValue={query.q} placeholder="Search name, email, tax ID, contact or tag" aria-label="Search customers" />
        <select name="type" defaultValue={query.type ?? ""} aria-label="Type">
          <option value="">All types</option>
          <option value="organization">Organizations</option>
          <option value="person">People</option>
        </select>
        <select name="sort" defaultValue={query.sort} aria-label="Sort">
          <option value="name">Name A–Z</option>
          <option value="recent">Recently updated</option>
          <option value="created">Newest first</option>
        </select>
        {query.archived ? <input type="hidden" name="archived" value="1" /> : null}
        <button type="submit" className="new-button">Search</button>
        <Link href={href({ archived: query.archived ? undefined : "1", page: 1 })} className="link-button">
          {query.archived ? "Show active" : "Show archived"}
        </Link>
      </form>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>{total === 1 ? "1 customer" : `${total} customers`}</h3>
            <p>{query.q ? `Matching “${query.q}”` : "Sorted " + { name: "by name", recent: "by last update", created: "newest first" }[query.sort ?? "name"]}</p>
          </div>
        </div>
        {items.length === 0 ? (
          <p className="team-empty">
            {query.q || query.type ? "No customers match these filters." : query.archived ? "No archived customers." : "No customers yet."}
          </p>
        ) : (
          <table className="team-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Primary contact</th>
                <th>Country</th>
                <th>Tags</th>
              </tr>
            </thead>
            <tbody>
              {items.map((customer) => {
                const contact = customer.contacts[0];
                return (
                  <tr key={customer.id}>
                    <td>
                      <Link href={`/app/customers/${customer.id}`} className="row-link">
                        <strong>{customer.displayName}</strong>
                      </Link>
                      <small>{customer.type === "person" ? "Person" : "Organization"}{customer.email ? ` · ${customer.email}` : ""}</small>
                    </td>
                    <td>{contact ? <>{contact.name}<small>{contact.email ?? contact.phone ?? ""}</small></> : "—"}</td>
                    <td>{customer.countryCode ?? "—"}</td>
                    <td>{customer.tags.length ? customer.tags.map((tag) => <span key={tag} className="pill tag">{tag}</span>) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {pageCount > 1 ? (
          <nav className="pager" aria-label="Pages">
            {page > 1 ? <Link href={href({ page: page - 1 })}>← Previous</Link> : <span />}
            <span>Page {page} of {pageCount}</span>
            {page < pageCount ? <Link href={href({ page: page + 1 })}>Next →</Link> : <span />}
          </nav>
        ) : null}
      </section>
    </>
  );
}
