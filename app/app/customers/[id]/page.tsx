import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCustomer } from "@/lib/customers/service";
import { RecordNotFoundError } from "@/lib/errors";
import { leadName } from "@/lib/leads/labels";
import { customerDuplicates } from "@/lib/records/duplicates";
import { settingsOptions } from "@/lib/organizations/options";
import { tenantData } from "@/lib/tenant";
import { requireTenant } from "@/lib/tenant/server";
import { PossibleDuplicates } from "../../_components/duplicates";
import { NoAccess } from "../../_components/no-access";
import { RecordWork } from "../../work/record-work";
import { setArchivedAction, updateCustomerAction } from "../actions";
import { CustomerForm } from "../customer-form";
import { ArchiveButton, Contacts } from "./customer-panels";

export const metadata: Metadata = { title: "Customer — MomentumDesk" };

export default async function CustomerPage({ params }: PageProps<"/app/customers/[id]">) {
  const tenant = await requireTenant("workspace:read");
  if (!tenant.can("customers:read")) return <NoAccess title="Customer" />;
  const { id } = await params;

  let customer;
  try {
    customer = await getCustomer(tenantData, tenant.organization.id, id);
  } catch (error) {
    // Missing and other-workspace customers look the same.
    if (error instanceof RecordNotFoundError) notFound();
    throw error;
  }

  const canEdit = tenant.can("customers:write");
  const canSeeLeads = tenant.can("sales:read");
  const duplicates = (await customerDuplicates(tenantData, tenant.organization.id, customer.id)).filter(
    (d) => d.type === "customer" || canSeeLeads,
  );
  const { countries, currencies, languages } = settingsOptions();
  const { organization } = tenant;
  const date = new Intl.DateTimeFormat(organization.locale, { dateStyle: "medium", timeZone: organization.timezone });
  const blank = (value: string | null) => value ?? "";

  return (
    <>
      <header className="topbar">
        <div>
          <p>
            <Link href="/app/customers" className="crumb">CUSTOMERS</Link>
            {customer.archivedAt ? " · ARCHIVED" : ""}
          </p>
          <h1>{customer.displayName}</h1>
        </div>
        {canEdit || tenant.can("quotes:write") ? (
          <div className="header-actions">
            {tenant.can("quotes:write") && !customer.archivedAt ? (
              <Link href={`/app/quotes/new?customer=${customer.id}`} className="new-button link-as-button">＋ New quote</Link>
            ) : null}
            {canEdit ? <ArchiveButton action={setArchivedAction.bind(null, customer.id, !customer.archivedAt)} archived={Boolean(customer.archivedAt)} /> : null}
          </div>
        ) : null}
      </header>
      <p className="record-meta">
        Added {date.format(customer.createdAt)}
        {customer.createdBy ? ` by ${customer.createdBy.name}` : ""} · Updated {date.format(customer.updatedAt)}
      </p>
      <section className="customer-layout">
        <div className="panel settings-panel wide">
          <CustomerForm
            action={updateCustomerAction.bind(null, customer.id)}
            version={customer.version}
            canEdit={canEdit}
            submitLabel="Save customer"
            countries={countries}
            currencies={currencies}
            languages={languages}
            initial={{
              type: customer.type,
              displayName: customer.displayName,
              legalName: blank(customer.legalName),
              email: blank(customer.email),
              phone: blank(customer.phone),
              website: blank(customer.website),
              taxId: blank(customer.taxId),
              countryCode: blank(customer.countryCode),
              addressLine1: blank(customer.addressLine1),
              addressLine2: blank(customer.addressLine2),
              city: blank(customer.city),
              region: blank(customer.region),
              postalCode: blank(customer.postalCode),
              preferredLocale: blank(customer.preferredLocale),
              preferredLanguage: blank(customer.preferredLanguage),
              preferredCurrency: blank(customer.preferredCurrency),
              tags: customer.tags.join(", "),
              notes: blank(customer.notes),
            }}
          />
        </div>
        <div className="record-side">
          <Contacts
            customerId={customer.id}
            canEdit={canEdit}
            contacts={customer.contacts.map(({ id, name, email, phone, jobTitle, isPrimary }) => ({
              id, name, email: email ?? "", phone: phone ?? "", jobTitle: jobTitle ?? "", isPrimary,
            }))}
          />
          {canSeeLeads && customer.leads.length > 0 ? (
            <aside className="panel contacts-panel" aria-label="Leads">
              <div className="panel-heading">
                <div>
                  <h3>Leads</h3>
                  <p>Leads converted into or linked to this customer, with their history.</p>
                </div>
              </div>
              <ul className="contact-list">
                {customer.leads.map((lead) => (
                  <li key={lead.id}>
                    <div>
                      <strong>
                        <Link href={`/app/leads/${lead.id}`}>{leadName(lead)}</Link>
                        <span className="pill">{lead.stage.name}</span>
                      </strong>
                      {lead.convertedAt ? <small>Converted {date.format(lead.convertedAt)}</small> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </aside>
          ) : null}
          <PossibleDuplicates duplicates={duplicates} />
        </div>
      </section>
      <RecordWork tenant={tenant} parent={{ type: "customer", id: customer.id }} canWrite={canEdit} />
    </>
  );
}
