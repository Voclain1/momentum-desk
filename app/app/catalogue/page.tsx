import type { Metadata } from "next";
import Link from "next/link";
import { formatPercent } from "@/lib/catalogue/schema";
import { listProducts } from "@/lib/catalogue/service";
import { formatMoney, money } from "@/lib/money";
import { tenantData } from "@/lib/tenant";
import { requireTenant } from "@/lib/tenant/server";
import { NoAccess } from "../_components/no-access";

export const metadata: Metadata = { title: "Catalogue — MomentumDesk" };

const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

export default async function CataloguePage({ searchParams }: PageProps<"/app/catalogue">) {
  const tenant = await requireTenant("workspace:read");
  if (!tenant.can("catalogue:read")) return <NoAccess title="Catalogue" />;
  const params = await searchParams;
  const query = { q: one(params.q), inactive: one(params.inactive) === "1", page: Number(one(params.page) ?? 1) };
  const { items, total, page, pageCount } = await listProducts(tenantData, tenant.organization.id, query);
  const { locale } = tenant.organization;

  const href = (changes: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams();
    const merged = { q: query.q, inactive: query.inactive ? "1" : undefined, page, ...changes };
    for (const [key, value] of Object.entries(merged)) {
      if (value !== undefined && value !== "" && !(key === "page" && value === 1)) next.set(key, String(value));
    }
    const search = next.toString();
    return search ? `/app/catalogue?${search}` : "/app/catalogue";
  };

  return (
    <>
      <header className="topbar">
        <div>
          <p>CATALOGUE</p>
          <h1>{query.inactive ? "Inactive products" : "Products and services"}</h1>
        </div>
        {tenant.can("catalogue:write") ? (
          <div className="header-actions">
            <Link href="/app/catalogue/new" className="new-button link-as-button">
              <span aria-hidden>＋</span> New product
            </Link>
          </div>
        ) : null}
      </header>

      <form className="list-filters" role="search" action="/app/catalogue">
        <input type="search" name="q" defaultValue={query.q} placeholder="Search name, SKU, category or description" aria-label="Search products" />
        {query.inactive ? <input type="hidden" name="inactive" value="1" /> : null}
        <button type="submit" className="new-button">Search</button>
        <Link href={href({ inactive: query.inactive ? undefined : "1", page: 1 })} className="link-button">
          {query.inactive ? "Show active" : "Show inactive"}
        </Link>
      </form>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>{total === 1 ? "1 product" : `${total} products`}</h3>
            <p>Prices are per currency and never converted.</p>
          </div>
        </div>
        {items.length === 0 ? (
          <p className="team-empty">{query.q ? "No products match this search." : query.inactive ? "No inactive products." : "No products yet."}</p>
        ) : (
          <table className="team-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Unit</th>
                <th>Prices</th>
                <th>Default tax</th>
              </tr>
            </thead>
            <tbody>
              {items.map((product) => (
                <tr key={product.id}>
                  <td>
                    <Link href={`/app/catalogue/${product.id}`} className="row-link">
                      <strong>{product.name}</strong>
                    </Link>
                    <small>{[product.sku, product.category].filter(Boolean).join(" · ")}</small>
                  </td>
                  <td>{product.unit ?? "—"}</td>
                  <td>
                    {product.prices.length
                      ? product.prices.map((price) => (
                          <span key={price.currency} className="pill">{formatMoney(money(price.unitPriceMinor, price.currency), locale)}</span>
                        ))
                      : "Priced on each quote"}
                  </td>
                  <td>{product.taxRate ? `${product.taxRate.name} (${formatPercent(product.taxRate.milliPercent)}%)` : "—"}</td>
                </tr>
              ))}
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
