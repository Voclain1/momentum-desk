-- CreateTable
CREATE TABLE "customer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "legalName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "taxId" TEXT,
    "countryCode" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postalCode" TEXT,
    "preferredLocale" TEXT,
    "preferredLanguage" TEXT,
    "preferredCurrency" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "archivedAt" TIMESTAMPTZ(3),
    "createdById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "jobTitle" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_organizationId_archivedAt_displayName_idx" ON "customer"("organizationId", "archivedAt", "displayName");

-- CreateIndex
CREATE INDEX "customer_organizationId_updatedAt_idx" ON "customer"("organizationId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "customer_id_organizationId_key" ON "customer"("id", "organizationId");

-- CreateIndex
CREATE INDEX "contact_organizationId_customerId_idx" ON "contact"("organizationId", "customerId");

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact" ADD CONSTRAINT "contact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact" ADD CONSTRAINT "contact_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "customer"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Tenant isolation, as for auditLog (docs/tenant-isolation.md).
-- ---------------------------------------------------------------------------
ALTER TABLE "customer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer" FORCE ROW LEVEL SECURITY;
CREATE POLICY "customer_tenant_isolation" ON "customer"
    USING ("organizationId" = app_current_organization_id())
    WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "contact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contact" FORCE ROW LEVEL SECURITY;
CREATE POLICY "contact_tenant_isolation" ON "contact"
    USING ("organizationId" = app_current_organization_id())
    WITH CHECK ("organizationId" = app_current_organization_id());

-- Formats. The application validates the full rules (lib/customers).
ALTER TABLE "customer"
    ADD CONSTRAINT "customer_type_check" CHECK ("type" IN ('person', 'organization')),
    ADD CONSTRAINT "customer_displayName_check" CHECK (length(btrim("displayName")) > 0),
    ADD CONSTRAINT "customer_email_check" CHECK ("email" = lower("email")),
    ADD CONSTRAINT "customer_countryCode_check" CHECK ("countryCode" ~ '^[A-Z]{2}$'),
    ADD CONSTRAINT "customer_preferredCurrency_check" CHECK ("preferredCurrency" ~ '^[A-Z]{3}$'),
    ADD CONSTRAINT "customer_version_check" CHECK ("version" >= 1);

ALTER TABLE "contact"
    ADD CONSTRAINT "contact_name_check" CHECK (length(btrim("name")) > 0),
    ADD CONSTRAINT "contact_email_check" CHECK ("email" = lower("email"));

-- At most one primary contact per customer.
CREATE UNIQUE INDEX "contact_one_primary_per_customer"
    ON "contact" ("customerId") WHERE "isPrimary";
