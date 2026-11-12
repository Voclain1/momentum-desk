import type { Metadata } from "next";
import Link from "next/link";
import { requireTenant } from "@/lib/tenant/server";
import { NoAccess } from "../../_components/no-access";
import { createProductAction } from "../actions";
import { productFormData } from "../page-data";
import { ProductForm } from "../product-form";

export const metadata: Metadata = { title: "New product — MomentumDesk" };

export default async function NewProductPage() {
  const tenant = await requireTenant("workspace:read");
  if (!tenant.can("catalogue:write")) return <NoAccess title="New product" />;
  const { organization } = tenant;
  const options = await productFormData(organization.id);
  const currency = organization.defaultInvoiceCurrency ?? organization.baseCurrency;
  return (
    <>
      <header className="topbar">
        <div>
          <p><Link href="/app/catalogue" className="crumb">CATALOGUE</Link></p>
          <h1>New product or service</h1>
        </div>
      </header>
      <section className="settings-page">
        <div className="panel settings-panel wide">
          <ProductForm
            action={createProductAction}
            canEdit
            submitLabel="Add product"
            {...options}
            initial={{ name: "", description: "", sku: "", unit: "", category: "", taxRateId: "", prices: [{ currency, amount: "" }] }}
          />
        </div>
      </section>
    </>
  );
}
