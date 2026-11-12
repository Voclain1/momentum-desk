-- CreateTable
CREATE TABLE "invoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "customerId" TEXT NOT NULL,
    "leadId" TEXT,
    "quoteId" TEXT,
    "currency" TEXT NOT NULL,
    "taxMode" TEXT NOT NULL,
    "issuedOn" DATE NOT NULL,
    "dueOn" DATE NOT NULL,
    "recipientName" TEXT,
    "recipientEmail" TEXT,
    "customerSnapshot" JSONB NOT NULL,
    "notes" TEXT,
    "terms" TEXT,
    "paymentInstructions" TEXT,
    "subtotalMinor" BIGINT NOT NULL DEFAULT 0,
    "discountMinor" BIGINT NOT NULL DEFAULT 0,
    "taxMinor" BIGINT NOT NULL DEFAULT 0,
    "totalMinor" BIGINT NOT NULL DEFAULT 0,
    "taxLines" JSONB NOT NULL DEFAULT '[]',
    "paidMinor" BIGINT NOT NULL DEFAULT 0,
    "issuedAt" TIMESTAMPTZ(3),
    "viewedAt" TIMESTAMPTZ(3),
    "voidedAt" TIMESTAMPTZ(3),
    "voidReason" TEXT,
    "voidedById" TEXT,
    "disputedAt" TIMESTAMPTZ(3),
    "disputeReason" TEXT,
    "createdById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoiceItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "productId" TEXT,
    "description" TEXT NOT NULL,
    "quantityMilli" BIGINT NOT NULL,
    "unit" TEXT,
    "unitPriceMinor" BIGINT NOT NULL,
    "discountKind" TEXT NOT NULL DEFAULT 'none',
    "discountValue" BIGINT NOT NULL DEFAULT 0,
    "taxRateId" TEXT,
    "taxName" TEXT,
    "taxMilliPercent" INTEGER,
    "grossMinor" BIGINT NOT NULL,
    "discountMinor" BIGINT NOT NULL,
    "netMinor" BIGINT NOT NULL,

    CONSTRAINT "invoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "method" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "receivedOn" DATE NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "recordedById" TEXT,
    "voidedAt" TIMESTAMPTZ(3),
    "voidReason" TEXT,
    "voidedById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paymentAllocation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "voidedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoice_organizationId_status_dueOn_idx" ON "invoice"("organizationId", "status", "dueOn");

-- CreateIndex
CREATE INDEX "invoice_organizationId_customerId_idx" ON "invoice"("organizationId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_id_organizationId_key" ON "invoice"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_organizationId_number_key" ON "invoice"("organizationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_quoteId_organizationId_key" ON "invoice"("quoteId", "organizationId");

-- CreateIndex
CREATE INDEX "invoiceItem_organizationId_invoiceId_idx" ON "invoiceItem"("organizationId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "invoiceItem_invoiceId_position_key" ON "invoiceItem"("invoiceId", "position");

-- CreateIndex
CREATE INDEX "payment_organizationId_customerId_receivedOn_idx" ON "payment"("organizationId", "customerId", "receivedOn");

-- CreateIndex
CREATE UNIQUE INDEX "payment_id_organizationId_key" ON "payment"("id", "organizationId");

-- CreateIndex
CREATE INDEX "paymentAllocation_organizationId_invoiceId_idx" ON "paymentAllocation"("organizationId", "invoiceId");

-- CreateIndex
CREATE INDEX "paymentAllocation_organizationId_paymentId_idx" ON "paymentAllocation"("organizationId", "paymentId");

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "customer"("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_leadId_organizationId_fkey" FOREIGN KEY ("leadId", "organizationId") REFERENCES "lead"("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_quoteId_organizationId_fkey" FOREIGN KEY ("quoteId", "organizationId") REFERENCES "quote"("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoiceItem" ADD CONSTRAINT "invoiceItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoiceItem" ADD CONSTRAINT "invoiceItem_invoiceId_organizationId_fkey" FOREIGN KEY ("invoiceId", "organizationId") REFERENCES "invoice"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoiceItem" ADD CONSTRAINT "invoiceItem_productId_organizationId_fkey" FOREIGN KEY ("productId", "organizationId") REFERENCES "product"("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "customer"("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paymentAllocation" ADD CONSTRAINT "paymentAllocation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paymentAllocation" ADD CONSTRAINT "paymentAllocation_paymentId_organizationId_fkey" FOREIGN KEY ("paymentId", "organizationId") REFERENCES "payment"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paymentAllocation" ADD CONSTRAINT "paymentAllocation_invoiceId_organizationId_fkey" FOREIGN KEY ("invoiceId", "organizationId") REFERENCES "invoice"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Tenant isolation, as for auditLog (docs/tenant-isolation.md).
-- ---------------------------------------------------------------------------
ALTER TABLE "invoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoice" FORCE ROW LEVEL SECURITY;
CREATE POLICY "invoice_tenant_isolation" ON "invoice"
    USING ("organizationId" = app_current_organization_id())
    WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "invoiceItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoiceItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY "invoiceItem_tenant_isolation" ON "invoiceItem"
    USING ("organizationId" = app_current_organization_id())
    WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment" FORCE ROW LEVEL SECURITY;
CREATE POLICY "payment_tenant_isolation" ON "payment"
    USING ("organizationId" = app_current_organization_id())
    WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "paymentAllocation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "paymentAllocation" FORCE ROW LEVEL SECURITY;
CREATE POLICY "paymentAllocation_tenant_isolation" ON "paymentAllocation"
    USING ("organizationId" = app_current_organization_id())
    WITH CHECK ("organizationId" = app_current_organization_id());

-- ---------------------------------------------------------------------------
-- Checks
-- ---------------------------------------------------------------------------
ALTER TABLE "invoice"
    ADD CONSTRAINT "invoice_status_check" CHECK ("status" IN ('draft', 'issued', 'void')),
    ADD CONSTRAINT "invoice_tax_mode_check" CHECK ("taxMode" IN ('exclusive', 'inclusive')),
    ADD CONSTRAINT "invoice_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    ADD CONSTRAINT "invoice_dates_check" CHECK ("dueOn" >= "issuedOn"),
    ADD CONSTRAINT "invoice_totals_check" CHECK (
        "subtotalMinor" >= 0 AND "discountMinor" >= 0 AND "taxMinor" >= 0 AND "totalMinor" >= 0),
    -- Never more paid than invoiced (D32: no overpayments in V1).
    ADD CONSTRAINT "invoice_paid_check" CHECK ("paidMinor" >= 0 AND "paidMinor" <= "totalMinor"),
    -- A number exactly when issued or void (D30).
    ADD CONSTRAINT "invoice_number_check" CHECK (("status" = 'draft') = ("number" IS NULL)),
    ADD CONSTRAINT "invoice_issued_check" CHECK (("status" = 'draft') = ("issuedAt" IS NULL)),
    ADD CONSTRAINT "invoice_void_check" CHECK (
        ("status" = 'void') = ("voidedAt" IS NOT NULL)
        AND ("voidedAt" IS NULL) = ("voidReason" IS NULL)
        AND ("voidReason" IS NULL OR length(btrim("voidReason")) > 0)),
    ADD CONSTRAINT "invoice_dispute_check" CHECK (("disputedAt" IS NULL) = ("disputeReason" IS NULL)),
    ADD CONSTRAINT "invoice_version_check" CHECK ("version" >= 1);

ALTER TABLE "invoiceItem"
    ADD CONSTRAINT "invoiceItem_description_check" CHECK (length(btrim("description")) > 0),
    ADD CONSTRAINT "invoiceItem_quantity_check" CHECK ("quantityMilli" > 0),
    ADD CONSTRAINT "invoiceItem_amounts_check" CHECK (
        "unitPriceMinor" >= 0 AND "grossMinor" >= 0 AND "discountMinor" >= 0 AND "netMinor" = "grossMinor" - "discountMinor"),
    ADD CONSTRAINT "invoiceItem_discount_check" CHECK (
        ("discountKind" = 'none' AND "discountValue" = 0)
        OR ("discountKind" = 'percent' AND "discountValue" BETWEEN 0 AND 100000)
        OR ("discountKind" = 'fixed' AND "discountValue" >= 0)),
    ADD CONSTRAINT "invoiceItem_tax_check" CHECK (
        ("taxRateId" IS NULL AND "taxName" IS NULL AND "taxMilliPercent" IS NULL)
        OR ("taxRateId" IS NOT NULL AND "taxName" IS NOT NULL AND "taxMilliPercent" BETWEEN 0 AND 100000));

ALTER TABLE "payment"
    ADD CONSTRAINT "payment_amount_check" CHECK ("amountMinor" > 0),
    ADD CONSTRAINT "payment_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    ADD CONSTRAINT "payment_method_check" CHECK ("method" IN ('bank_transfer', 'cash', 'card', 'mobile_money', 'cheque', 'other')),
    ADD CONSTRAINT "payment_void_check" CHECK (
        ("voidedAt" IS NULL) = ("voidReason" IS NULL) AND ("voidReason" IS NULL OR length(btrim("voidReason")) > 0));

ALTER TABLE "paymentAllocation"
    ADD CONSTRAINT "paymentAllocation_amount_check" CHECK ("amountMinor" > 0);

-- ---------------------------------------------------------------------------
-- An issued invoice is fixed (D31). Its lifecycle fields change only along
-- the allowed paths, and paidMinor only through allocations (below).
-- ---------------------------------------------------------------------------
CREATE FUNCTION invoice_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD."status" <> 'draft' AND pg_trigger_depth() = 1 THEN
            RAISE EXCEPTION 'invoice % is %, so it cannot be deleted', OLD."id", OLD."status" USING ERRCODE = 'check_violation';
        END IF;
        RETURN OLD;
    END IF;
    -- Only the allocation trigger may change what was paid.
    IF NEW."paidMinor" IS DISTINCT FROM OLD."paidMinor" AND pg_trigger_depth() = 1 THEN
        RAISE EXCEPTION 'paidMinor is kept by payment allocations' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."status" = 'draft' THEN
        IF NEW."status" NOT IN ('draft', 'issued') THEN
            RAISE EXCEPTION 'a draft invoice can only be issued; delete it instead' USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;
    IF NOT ((OLD."status" = 'issued' AND NEW."status" IN ('issued', 'void')) OR NEW."status" = OLD."status") THEN
        RAISE EXCEPTION 'invoice cannot go from % to %', OLD."status", NEW."status" USING ERRCODE = 'check_violation';
    END IF;
    IF (NEW."number", NEW."customerId", NEW."leadId", NEW."quoteId", NEW."currency", NEW."taxMode", NEW."issuedOn", NEW."dueOn",
        NEW."recipientName", NEW."recipientEmail", NEW."customerSnapshot"::text, NEW."notes", NEW."terms", NEW."paymentInstructions",
        NEW."subtotalMinor", NEW."discountMinor", NEW."taxMinor", NEW."totalMinor", NEW."taxLines"::text, NEW."issuedAt",
        NEW."createdById", NEW."createdAt")
       IS DISTINCT FROM
       (OLD."number", OLD."customerId", OLD."leadId", OLD."quoteId", OLD."currency", OLD."taxMode", OLD."issuedOn", OLD."dueOn",
        OLD."recipientName", OLD."recipientEmail", OLD."customerSnapshot"::text, OLD."notes", OLD."terms", OLD."paymentInstructions",
        OLD."subtotalMinor", OLD."discountMinor", OLD."taxMinor", OLD."totalMinor", OLD."taxLines"::text, OLD."issuedAt",
        OLD."createdById", OLD."createdAt")
    THEN
        RAISE EXCEPTION 'invoice % was issued, so its content cannot change', OLD."id" USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."viewedAt" IS NOT NULL AND NEW."viewedAt" IS DISTINCT FROM OLD."viewedAt" THEN
        RAISE EXCEPTION 'invoice % first view cannot change', OLD."id" USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."status" = 'void' AND (
        (NEW."voidedAt", NEW."voidReason", NEW."voidedById", NEW."disputedAt", NEW."disputeReason")
        IS DISTINCT FROM (OLD."voidedAt", OLD."voidReason", OLD."voidedById", OLD."disputedAt", OLD."disputeReason")) THEN
        RAISE EXCEPTION 'invoice % is void', OLD."id" USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER invoice_guard BEFORE UPDATE OR DELETE ON "invoice"
    FOR EACH ROW EXECUTE FUNCTION invoice_guard();

CREATE FUNCTION invoice_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    parent_status text;
BEGIN
    SELECT "status" INTO parent_status FROM "invoice"
        WHERE "id" = COALESCE(NEW."invoiceId", OLD."invoiceId") AND "organizationId" = COALESCE(NEW."organizationId", OLD."organizationId");
    IF parent_status IS NOT NULL AND parent_status <> 'draft' THEN
        RAISE EXCEPTION 'invoice lines cannot change once the invoice is issued' USING ERRCODE = 'check_violation';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER invoice_item_guard BEFORE INSERT OR UPDATE OR DELETE ON "invoiceItem"
    FOR EACH ROW EXECUTE FUNCTION invoice_item_guard();

-- ---------------------------------------------------------------------------
-- Payments are never deleted or edited; a mistake is voided once, with a
-- reason, which also voids its allocations.
-- ---------------------------------------------------------------------------
CREATE FUNCTION payment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF pg_trigger_depth() = 1 THEN
            RAISE EXCEPTION 'payments are never deleted; void it instead' USING ERRCODE = 'check_violation';
        END IF;
        RETURN OLD;
    END IF;
    IF (NEW."customerId", NEW."currency", NEW."amountMinor", NEW."method", NEW."source", NEW."receivedOn", NEW."reference",
        NEW."note", NEW."recordedById", NEW."createdAt")
       IS DISTINCT FROM
       (OLD."customerId", OLD."currency", OLD."amountMinor", OLD."method", OLD."source", OLD."receivedOn", OLD."reference",
        OLD."note", OLD."recordedById", OLD."createdAt")
       OR OLD."voidedAt" IS NOT NULL THEN
        RAISE EXCEPTION 'payment % cannot change; void it instead', OLD."id" USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER payment_guard BEFORE UPDATE OR DELETE ON "payment"
    FOR EACH ROW EXECUTE FUNCTION payment_guard();

CREATE FUNCTION payment_void_allocations() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE "paymentAllocation" SET "voidedAt" = NEW."voidedAt"
        WHERE "paymentId" = NEW."id" AND "organizationId" = NEW."organizationId" AND "voidedAt" IS NULL;
    RETURN NEW;
END;
$$;

CREATE TRIGGER payment_void_allocations AFTER UPDATE OF "voidedAt" ON "payment"
    FOR EACH ROW WHEN (OLD."voidedAt" IS NULL AND NEW."voidedAt" IS NOT NULL)
    EXECUTE FUNCTION payment_void_allocations();

-- An allocation joins a valid payment to an issued invoice of the same
-- customer and currency. Afterwards it can only be voided.
CREATE FUNCTION payment_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    inv record;
    pay record;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF pg_trigger_depth() = 1 THEN
            RAISE EXCEPTION 'allocations are never deleted' USING ERRCODE = 'check_violation';
        END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF (NEW."paymentId", NEW."invoiceId", NEW."amountMinor", NEW."createdAt") IS DISTINCT FROM
           (OLD."paymentId", OLD."invoiceId", OLD."amountMinor", OLD."createdAt")
           OR OLD."voidedAt" IS NOT NULL THEN
            RAISE EXCEPTION 'allocation % can only be voided', OLD."id" USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;
    SELECT "status", "currency", "customerId" INTO inv FROM "invoice"
        WHERE "id" = NEW."invoiceId" AND "organizationId" = NEW."organizationId";
    SELECT "currency", "customerId", "voidedAt" INTO pay FROM "payment"
        WHERE "id" = NEW."paymentId" AND "organizationId" = NEW."organizationId";
    IF inv."status" IS DISTINCT FROM 'issued' THEN
        RAISE EXCEPTION 'payments can only be allocated to an issued invoice' USING ERRCODE = 'check_violation';
    END IF;
    IF pay."voidedAt" IS NOT NULL OR NEW."voidedAt" IS NOT NULL THEN
        RAISE EXCEPTION 'a voided payment cannot be allocated' USING ERRCODE = 'check_violation';
    END IF;
    IF pay."currency" <> inv."currency" OR pay."customerId" <> inv."customerId" THEN
        RAISE EXCEPTION 'a payment must be in the invoice''s currency and from its customer' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER payment_allocation_guard BEFORE INSERT OR UPDATE OR DELETE ON "paymentAllocation"
    FOR EACH ROW EXECUTE FUNCTION payment_allocation_guard();

-- paidMinor is the sum of valid allocations, kept in the same transaction.
-- The invoice_paid_check constraint then refuses any overpayment.
CREATE FUNCTION payment_allocation_sum() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE "invoice" SET "paidMinor" = (
        SELECT COALESCE(SUM(a."amountMinor"), 0) FROM "paymentAllocation" a
        WHERE a."invoiceId" = NEW."invoiceId" AND a."organizationId" = NEW."organizationId" AND a."voidedAt" IS NULL
    )
    WHERE "id" = NEW."invoiceId" AND "organizationId" = NEW."organizationId";
    RETURN NULL;
END;
$$;

CREATE TRIGGER payment_allocation_sum AFTER INSERT OR UPDATE ON "paymentAllocation"
    FOR EACH ROW EXECUTE FUNCTION payment_allocation_sum();
