-- CreateTable
CREATE TABLE "taxRate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "milliPercent" INTEGER NOT NULL,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "taxRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sku" TEXT,
    "unit" TEXT,
    "category" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "taxRateId" TEXT,
    "createdById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "productPrice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "unitPriceMinor" BIGINT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "productPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "taxRate_organizationId_archivedAt_idx" ON "taxRate"("organizationId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "taxRate_id_organizationId_key" ON "taxRate"("id", "organizationId");

-- CreateIndex
CREATE INDEX "product_organizationId_active_name_idx" ON "product"("organizationId", "active", "name");

-- CreateIndex
CREATE UNIQUE INDEX "product_id_organizationId_key" ON "product"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "product_organizationId_sku_key" ON "product"("organizationId", "sku");

-- CreateIndex
CREATE INDEX "productPrice_organizationId_productId_idx" ON "productPrice"("organizationId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "productPrice_productId_currency_key" ON "productPrice"("productId", "currency");

-- AddForeignKey
ALTER TABLE "taxRate" ADD CONSTRAINT "taxRate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_taxRateId_organizationId_fkey" FOREIGN KEY ("taxRateId", "organizationId") REFERENCES "taxRate"("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productPrice" ADD CONSTRAINT "productPrice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productPrice" ADD CONSTRAINT "productPrice_productId_organizationId_fkey" FOREIGN KEY ("productId", "organizationId") REFERENCES "product"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Tenant isolation, as for auditLog (docs/tenant-isolation.md).
-- ---------------------------------------------------------------------------
ALTER TABLE "taxRate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "taxRate" FORCE ROW LEVEL SECURITY;
CREATE POLICY "taxRate_tenant_isolation" ON "taxRate"
    USING ("organizationId" = app_current_organization_id())
    WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "product" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product" FORCE ROW LEVEL SECURITY;
CREATE POLICY "product_tenant_isolation" ON "product"
    USING ("organizationId" = app_current_organization_id())
    WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "productPrice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "productPrice" FORCE ROW LEVEL SECURITY;
CREATE POLICY "productPrice_tenant_isolation" ON "productPrice"
    USING ("organizationId" = app_current_organization_id())
    WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "taxRate"
    ADD CONSTRAINT "taxRate_name_check" CHECK (length(btrim("name")) > 0),
    -- 0% to 100%, in thousandths of a percent (decision D12).
    ADD CONSTRAINT "taxRate_milli_percent_check" CHECK ("milliPercent" BETWEEN 0 AND 100000);

ALTER TABLE "product"
    ADD CONSTRAINT "product_name_check" CHECK (length(btrim("name")) > 0),
    ADD CONSTRAINT "product_sku_check" CHECK ("sku" IS NULL OR length(btrim("sku")) > 0),
    ADD CONSTRAINT "product_version_check" CHECK ("version" >= 1);

ALTER TABLE "productPrice"
    ADD CONSTRAINT "productPrice_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    ADD CONSTRAINT "productPrice_amount_check" CHECK ("unitPriceMinor" >= 0);
