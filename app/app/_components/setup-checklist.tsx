import Link from "next/link";
import { getBranding } from "@/lib/branding/service";
import { invoiceSettings } from "@/lib/invoices/settings";
import { tenantData } from "@/lib/tenant";
import type { Tenant } from "@/lib/tenant/server";

/**
 * The optional onboarding steps (spec §14: logo and invoice details,
 * products, imports), each skippable and done whenever suits. Shown to
 * owners and admins until every step is done.
 */
export async function SetupChecklist({ tenant }: { tenant: Tenant }) {
  if (!tenant.can("settings:write")) return null;
  const organizationId = tenant.organization.id;
  const scoped = tenantData.scoped(organizationId);
  const [branding, invoices, products, customers, leads] = await Promise.all([
    getBranding(tenantData, organizationId),
    invoiceSettings(tenantData, organizationId),
    scoped.product.count(),
    scoped.customer.count(),
    scoped.lead.count(),
  ]);
  const steps = [
    { done: Boolean(branding.logo), label: "Add your logo", detail: "Shown on quotes, invoices and emails.", href: "/app/settings" },
    { done: Boolean(invoices.paymentInstructions), label: "Add how customers pay you", detail: "Bank details or other payment instructions on invoices.", href: "/app/settings" },
    { done: products > 0, label: "Add products or services", detail: "Optional: quote faster from your catalogue.", href: "/app/catalogue/new" },
    { done: customers + leads > 0, label: "Import or add customers and leads", detail: "Optional: from a CSV file, or one by one.", href: "/app/import?type=customers" },
  ];
  if (steps.every((s) => s.done)) return null;
  return (
    <section className="panel contacts-panel" aria-label="Set up your workspace">
      <div className="panel-heading">
        <div><h3>Set up your workspace</h3><p>{steps.filter((s) => s.done).length} of {steps.length} done. Skip any of these and come back later.</p></div>
      </div>
      <ul className="contact-list">
        {steps.map((step) => (
          <li key={step.label}>
            <div>
              <strong>{step.done ? "✓ " : ""}{step.label}</strong>
              <small>{step.detail}</small>
            </div>
            {step.done ? <span className="form-hint">Done</span> : <Link href={step.href} className="link-button">Do this</Link>}
          </li>
        ))}
      </ul>
    </section>
  );
}
