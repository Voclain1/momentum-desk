-- CreateTable
CREATE TABLE "exchangeRate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "base" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "rate" DECIMAL(24,12) NOT NULL,
    "source" TEXT NOT NULL,
    "effectiveOn" DATE NOT NULL,
    "enteredById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoiceCollection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "pausedUntil" DATE,
    "pauseReason" TEXT,
    "escalatedAt" TIMESTAMPTZ(3),
    "escalationNote" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoiceCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promiseToPay" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "promisedOn" DATE NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "paidAtStartMinor" BIGINT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "takenById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(3),

    CONSTRAINT "promiseToPay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collectionNote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collectionNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exchangeRate_organizationId_quote_effectiveOn_idx" ON "exchangeRate"("organizationId", "quote", "effectiveOn");

-- CreateIndex
CREATE UNIQUE INDEX "exchangeRate_organizationId_base_quote_effectiveOn_source_key" ON "exchangeRate"("organizationId", "base", "quote", "effectiveOn", "source");

-- CreateIndex
CREATE INDEX "invoiceCollection_organizationId_status_idx" ON "invoiceCollection"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "invoiceCollection_invoiceId_organizationId_key" ON "invoiceCollection"("invoiceId", "organizationId");

-- CreateIndex
CREATE INDEX "promiseToPay_organizationId_invoiceId_idx" ON "promiseToPay"("organizationId", "invoiceId");

-- CreateIndex
CREATE INDEX "promiseToPay_organizationId_status_promisedOn_idx" ON "promiseToPay"("organizationId", "status", "promisedOn");

-- CreateIndex
CREATE INDEX "collectionNote_organizationId_invoiceId_createdAt_idx" ON "collectionNote"("organizationId", "invoiceId", "createdAt");

-- AddForeignKey
ALTER TABLE "exchangeRate" ADD CONSTRAINT "exchangeRate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchangeRate" ADD CONSTRAINT "exchangeRate_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoiceCollection" ADD CONSTRAINT "invoiceCollection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoiceCollection" ADD CONSTRAINT "invoiceCollection_invoiceId_organizationId_fkey" FOREIGN KEY ("invoiceId", "organizationId") REFERENCES "invoice"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoiceCollection" ADD CONSTRAINT "invoiceCollection_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promiseToPay" ADD CONSTRAINT "promiseToPay_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promiseToPay" ADD CONSTRAINT "promiseToPay_invoiceId_organizationId_fkey" FOREIGN KEY ("invoiceId", "organizationId") REFERENCES "invoice"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promiseToPay" ADD CONSTRAINT "promiseToPay_takenById_fkey" FOREIGN KEY ("takenById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collectionNote" ADD CONSTRAINT "collectionNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collectionNote" ADD CONSTRAINT "collectionNote_invoiceId_organizationId_fkey" FOREIGN KEY ("invoiceId", "organizationId") REFERENCES "invoice"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collectionNote" ADD CONSTRAINT "collectionNote_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Tenant isolation, as for auditLog (docs/tenant-isolation.md).
ALTER TABLE "exchangeRate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exchangeRate" FORCE ROW LEVEL SECURITY;
CREATE POLICY "exchangeRate_tenant_isolation" ON "exchangeRate"
    USING ("organizationId" = app_current_organization_id())
    WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "invoiceCollection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoiceCollection" FORCE ROW LEVEL SECURITY;
CREATE POLICY "invoiceCollection_tenant_isolation" ON "invoiceCollection"
    USING ("organizationId" = app_current_organization_id())
    WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "promiseToPay" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "promiseToPay" FORCE ROW LEVEL SECURITY;
CREATE POLICY "promiseToPay_tenant_isolation" ON "promiseToPay"
    USING ("organizationId" = app_current_organization_id())
    WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "collectionNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "collectionNote" FORCE ROW LEVEL SECURITY;
CREATE POLICY "collectionNote_tenant_isolation" ON "collectionNote"
    USING ("organizationId" = app_current_organization_id())
    WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "exchangeRate"
    ADD CONSTRAINT "exchangeRate_currencies_check" CHECK ("base" ~ '^[A-Z]{3}$' AND "quote" ~ '^[A-Z]{3}$' AND "base" <> "quote"),
    ADD CONSTRAINT "exchangeRate_rate_check" CHECK ("rate" > 0),
    ADD CONSTRAINT "exchangeRate_source_check" CHECK ("source" ~ '^[a-z]+$'),
    -- Staff rates name who entered them.
    ADD CONSTRAINT "exchangeRate_manual_check" CHECK (("source" = 'manual') = ("enteredById" IS NOT NULL) OR "source" <> 'manual');

ALTER TABLE "invoiceCollection"
    ADD CONSTRAINT "invoiceCollection_status_check" CHECK ("status" IN ('open', 'escalated', 'paused')),
    ADD CONSTRAINT "invoiceCollection_pause_check" CHECK (("status" = 'paused') = ("pausedUntil" IS NOT NULL)),
    ADD CONSTRAINT "invoiceCollection_escalation_check" CHECK (("status" = 'escalated') = ("escalatedAt" IS NOT NULL) OR "status" <> 'escalated'),
    ADD CONSTRAINT "invoiceCollection_version_check" CHECK ("version" >= 1);

ALTER TABLE "promiseToPay"
    ADD CONSTRAINT "promiseToPay_amount_check" CHECK ("amountMinor" > 0 AND "paidAtStartMinor" >= 0),
    ADD CONSTRAINT "promiseToPay_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    ADD CONSTRAINT "promiseToPay_status_check" CHECK ("status" IN ('open', 'kept', 'broken', 'cancelled')),
    ADD CONSTRAINT "promiseToPay_resolved_check" CHECK (("status" = 'open') = ("resolvedAt" IS NULL));

ALTER TABLE "collectionNote"
    ADD CONSTRAINT "collectionNote_body_check" CHECK (length(btrim("body")) > 0);

-- Rates are a record: never edited; a correction is a new rate (append-only).
CREATE FUNCTION "exchangeRate_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF pg_trigger_depth() > 1 THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    RAISE EXCEPTION 'exchangeRate is append-only: % is not allowed', TG_OP USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER "exchangeRate_append_only"
    BEFORE UPDATE OR DELETE ON "exchangeRate"
    FOR EACH ROW EXECUTE FUNCTION "exchangeRate_append_only"();
