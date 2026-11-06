import type { Metadata } from "next";
import Link from "next/link";
import { settingsOptions } from "@/lib/organizations/options";
import { requireTenant } from "@/lib/tenant/server";
import { NoAccess } from "../../_components/no-access";
import { createCustomerAction } from "../actions";
import { CustomerForm, EMPTY_CUSTOMER } from "../customer-form";

export const metadata: Metadata = { title: "New customer — MomentumDesk" };

export default async function NewCustomerPage() {
  const tenant = await requireTenant("workspace:read");
  if (!tenant.can("customers:write")) return <NoAccess title="New customer" />;
  const { countries, currencies, languages } = settingsOptions();
  return (
    <>
      <header className="topbar">
        <div>
          <p>
            <Link href="/app/customers" className="crumb">CUSTOMERS</Link>
          </p>
          <h1>New customer</h1>
        </div>
      </header>
      <section className="settings-page">
        <div className="panel settings-panel wide">
          <CustomerForm
            action={createCustomerAction}
            initial={EMPTY_CUSTOMER}
            canEdit
            submitLabel="Add customer"
            countries={countries}
            currencies={currencies}
            languages={languages}
          />
        </div>
      </section>
    </>
  );
}
