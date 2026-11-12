import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getProduct } from "@/lib/catalogue/service";
import { RecordNotFoundError } from "@/lib/errors";
import { money, toDecimalString } from "@/lib/money";
import { tenantData } from "@/lib/tenant";
import { requireTenant } from "@/lib/tenant/server";
import { ArchiveButton } from "../../customers/[id]/customer-panels";
import { NoAccess } from "../../_components/no-access";
import { setProductActiveAction, updateProductAction } from "../actions";
import { productFormData } from "../page-data";
import { ProductForm } from "../product-form";

export const metadata: Metadata = { title: "Product — MomentumDesk" };

export default async function ProductPage({ params }: PageProps<"/app/catalogue/[id]">) {
  const tenant = await requireTenant("workspace:read");
  if (!tenant.can("catalogue:read")) return <NoAccess title="Product" />;
  const { id } = await params;
  let product;
  try {
    product = await getProduct(tenantData, tenant.organization.id, id);
  } catch (error) {
    if (error instanceof RecordNotFoundError) notFound();
    throw error;
  }
  const canEdit = tenant.can("catalogue:write");
  const options = await productFormData(tenant.organization.id, product.taxRate);
  const blank = (value: string | null) => value ?? "";

  return (
    <>
      <header className="topbar">
        <div>
          <p>
            <Link href="/app/catalogue" className="crumb">CATALOGUE</Link>
            {product.active ? "" : " · INACTIVE"}
          </p>
          <h1>{product.name}</h1>
        </div>
        {canEdit ? (
          <div className="header-actions">
            <ArchiveButton
              action={setProductActiveAction.bind(null, product.id, !product.active)}
              archived={!product.active}
              noun="product"
              labels={{ archive: "Deactivate", restore: "Reactivate product" }}
              confirm="Deactivate this product? Existing quotes keep it; it is no longer offered for new lines."
            />
          </div>
        ) : null}
      </header>
      <section className="settings-page">
        <div className="panel settings-panel wide">
          <ProductForm
            action={updateProductAction.bind(null, product.id)}
            version={product.version}
            canEdit={canEdit}
            submitLabel="Save product"
            {...options}
            initial={{
              name: product.name,
              description: blank(product.description),
              sku: blank(product.sku),
              unit: blank(product.unit),
              category: blank(product.category),
              taxRateId: blank(product.taxRateId),
              prices: product.prices.map((price) => ({
                currency: price.currency,
                amount: toDecimalString(money(price.unitPriceMinor, price.currency)),
              })),
            }}
          />
        </div>
      </section>
    </>
  );
}
