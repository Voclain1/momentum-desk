-- CreateTable
CREATE TABLE "documentSequence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "padding" INTEGER NOT NULL DEFAULT 4,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "documentSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "previousId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "customerId" TEXT NOT NULL,
    "leadId" TEXT,
    "currency" TEXT NOT NULL,
    "taxMode" TEXT NOT NULL,
    "issuedOn" DATE NOT NULL,
    "expiresOn" DATE NOT NULL,
    "recipientName" TEXT,
    "recipientEmail" TEXT,
    "customerSnapshot" JSONB NOT NULL,
    "notes" TEXT,
    "terms" TEXT,
    "subtotalMinor" BIGINT NOT NULL DEFAULT 0,
    "discountMinor" BIGINT NOT NULL DEFAULT 0,
    "taxMinor" BIGINT NOT NULL DEFAULT 0,
    "totalMinor" BIGINT NOT NULL DEFAULT 0,
    "taxLines" JSONB NOT NULL DEFAULT '[]',
    "sentAt" TIMESTAMPTZ(3),
    "viewedAt" TIMESTAMPTZ(3),
    "acceptedAt" TIMESTAMPTZ(3),
    "rejectedAt" TIMESTAMPTZ(3),
    "createdById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quoteItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
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

    CONSTRAINT "quoteItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "documentSequence_organizationId_kind_key" ON "documentSequence"("organizationId", "kind");

-- CreateIndex
CREATE INDEX "quote_organizationId_status_updatedAt_idx" ON "quote"("organizationId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "quote_organizationId_customerId_idx" ON "quote"("organizationId", "customerId");

-- CreateIndex
CREATE INDEX "quote_organizationId_leadId_idx" ON "quote"("organizationId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "quote_id_organizationId_key" ON "quote"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "quote_organizationId_number_revision_key" ON "quote"("organizationId", "number", "revision");

-- CreateIndex
CREATE INDEX "quoteItem_organizationId_quoteId_idx" ON "quoteItem"("organizationId", "quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "quoteItem_quoteId_position_key" ON "quoteItem"("quoteId", "position");

-- AddForeignKey
ALTER TABLE "documentSequence" ADD CONSTRAINT "documentSequence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote" ADD CONSTRAINT "quote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote" ADD CONSTRAINT "quote_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "customer"("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote" ADD CONSTRAINT "quote_leadId_organizationId_fkey" FOREIGN KEY ("leadId", "organizationId") REFERENCES "lead"("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote" ADD CONSTRAINT "quote_previousId_organizationId_fkey" FOREIGN KEY ("previousId", "organizationId") REFERENCES "quote"("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote" ADD CONSTRAINT "quote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quoteItem" ADD CONSTRAINT "quoteItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quoteItem" ADD CONSTRAINT "quoteItem_quoteId_organizationId_fkey" FOREIGN KEY ("quoteId", "organizationId") REFERENCES "quote"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quoteItem" ADD CONSTRAINT "quoteItem_productId_organizationId_fkey" FOREIGN KEY ("productId", "organizationId") REFERENCES "product"("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Tenant isolation, as for auditLog (docs/tenant-isolation.md).
-- ---------------------------------------------------------------------------
ALTER TABLE "documentSequence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "documentSequence" FORCE ROW LEVEL SECURITY;
CREATE POLICY "documentSequence_tenant_isolation" ON "documentSequence"
    USING ("organizationId" = app_current_organization_id())
    WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "quote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quote" FORCE ROW LEVEL SECURITY;
CREATE POLICY "quote_tenant_isolation" ON "quote"
    USING ("organizationId" = app_current_organization_id())
    WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "quoteItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quoteItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY "quoteItem_tenant_isolation" ON "quoteItem"
    USING ("organizationId" = app_current_organization_id())
    WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "documentSequence"
    ADD CONSTRAINT "documentSequence_kind_check" CHECK ("kind" IN ('quote', 'invoice')),
    ADD CONSTRAINT "documentSequence_prefix_check" CHECK (length("prefix") <= 12),
    ADD CONSTRAINT "documentSequence_next_check" CHECK ("nextNumber" >= 1),
    ADD CONSTRAINT "documentSequence_padding_check" CHECK ("padding" BETWEEN 1 AND 10);

ALTER TABLE "quote"
    ADD CONSTRAINT "quote_status_check" CHECK ("status" IN ('draft', 'sent', 'accepted', 'rejected', 'superseded')),
    ADD CONSTRAINT "quote_tax_mode_check" CHECK ("taxMode" IN ('exclusive', 'inclusive')),
    ADD CONSTRAINT "quote_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    ADD CONSTRAINT "quote_revision_check" CHECK ("revision" >= 1 AND ("revision" = 1) = ("previousId" IS NULL)),
    ADD CONSTRAINT "quote_dates_check" CHECK ("expiresOn" >= "issuedOn"),
    ADD CONSTRAINT "quote_totals_check" CHECK (
        "subtotalMinor" >= 0 AND "discountMinor" >= 0 AND "taxMinor" >= 0 AND "totalMinor" >= 0),
    -- Each lifecycle timestamp exists exactly when its state was reached.
    ADD CONSTRAINT "quote_sent_check" CHECK (("status" = 'draft') = ("sentAt" IS NULL)),
    ADD CONSTRAINT "quote_accepted_check" CHECK (("status" = 'accepted') = ("acceptedAt" IS NOT NULL)),
    ADD CONSTRAINT "quote_rejected_check" CHECK (("status" = 'rejected') = ("rejectedAt" IS NOT NULL)),
    ADD CONSTRAINT "quote_version_check" CHECK ("version" >= 1);

ALTER TABLE "quoteItem"
    ADD CONSTRAINT "quoteItem_description_check" CHECK (length(btrim("description")) > 0),
    ADD CONSTRAINT "quoteItem_quantity_check" CHECK ("quantityMilli" > 0),
    ADD CONSTRAINT "quoteItem_amounts_check" CHECK (
        "unitPriceMinor" >= 0 AND "grossMinor" >= 0 AND "discountMinor" >= 0 AND "netMinor" = "grossMinor" - "discountMinor"),
    ADD CONSTRAINT "quoteItem_discount_check" CHECK (
        ("discountKind" = 'none' AND "discountValue" = 0)
        OR ("discountKind" = 'percent' AND "discountValue" BETWEEN 0 AND 100000)
        OR ("discountKind" = 'fixed' AND "discountValue" >= 0)),
    ADD CONSTRAINT "quoteItem_tax_check" CHECK (
        ("taxRateId" IS NULL AND "taxName" IS NULL AND "taxMilliPercent" IS NULL)
        OR ("taxRateId" IS NOT NULL AND "taxName" IS NOT NULL AND "taxMilliPercent" BETWEEN 0 AND 100000));

-- ---------------------------------------------------------------------------
-- A sent quote is a fixed snapshot (spec §7.5, §9 "snapshot document data"):
-- whatever code runs, only its lifecycle fields can change, only along the
-- allowed transitions, and its lines cannot change at all. A draft is free.
-- ---------------------------------------------------------------------------
CREATE FUNCTION quote_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        -- Direct deletes only for drafts; deleting the workspace cascades.
        IF OLD."status" <> 'draft' AND pg_trigger_depth() = 1 THEN
            RAISE EXCEPTION 'quote % is %, so it cannot be deleted', OLD."id", OLD."status" USING ERRCODE = 'check_violation';
        END IF;
        RETURN OLD;
    END IF;
    IF OLD."status" = 'draft' THEN
        IF NEW."status" NOT IN ('draft', 'sent') THEN
            RAISE EXCEPTION 'a draft quote can only be sent' USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;
    IF NOT (
        (OLD."status" = 'sent' AND NEW."status" IN ('sent', 'accepted', 'rejected', 'superseded'))
        OR NEW."status" = OLD."status"
    ) THEN
        RAISE EXCEPTION 'quote cannot go from % to %', OLD."status", NEW."status" USING ERRCODE = 'check_violation';
    END IF;
    IF (NEW."number", NEW."revision", NEW."previousId", NEW."customerId", NEW."leadId", NEW."currency", NEW."taxMode",
        NEW."issuedOn", NEW."expiresOn", NEW."recipientName", NEW."recipientEmail", NEW."customerSnapshot"::text,
        NEW."notes", NEW."terms", NEW."subtotalMinor", NEW."discountMinor", NEW."taxMinor", NEW."totalMinor",
        NEW."taxLines"::text, NEW."sentAt", NEW."createdById", NEW."createdAt")
       IS DISTINCT FROM
       (OLD."number", OLD."revision", OLD."previousId", OLD."customerId", OLD."leadId", OLD."currency", OLD."taxMode",
        OLD."issuedOn", OLD."expiresOn", OLD."recipientName", OLD."recipientEmail", OLD."customerSnapshot"::text,
        OLD."notes", OLD."terms", OLD."subtotalMinor", OLD."discountMinor", OLD."taxMinor", OLD."totalMinor",
        OLD."taxLines"::text, OLD."sentAt", OLD."createdById", OLD."createdAt")
    THEN
        RAISE EXCEPTION 'quote % was sent, so its content cannot change', OLD."id" USING ERRCODE = 'check_violation';
    END IF;
    -- First view, acceptance and rejection are recorded once.
    IF (OLD."viewedAt" IS NOT NULL AND NEW."viewedAt" IS DISTINCT FROM OLD."viewedAt")
       OR (OLD."acceptedAt" IS NOT NULL AND NEW."acceptedAt" IS DISTINCT FROM OLD."acceptedAt")
       OR (OLD."rejectedAt" IS NOT NULL AND NEW."rejectedAt" IS DISTINCT FROM OLD."rejectedAt") THEN
        RAISE EXCEPTION 'quote % evidence cannot change', OLD."id" USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER quote_guard BEFORE UPDATE OR DELETE ON "quote"
    FOR EACH ROW EXECUTE FUNCTION quote_guard();

CREATE FUNCTION quote_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    parent_status text;
BEGIN
    SELECT "status" INTO parent_status FROM "quote"
        WHERE "id" = COALESCE(NEW."quoteId", OLD."quoteId") AND "organizationId" = COALESCE(NEW."organizationId", OLD."organizationId");
    -- No parent: the quote itself is being deleted (cascade).
    IF parent_status IS NOT NULL AND parent_status <> 'draft' THEN
        RAISE EXCEPTION 'quote lines cannot change once the quote is sent' USING ERRCODE = 'check_violation';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER quote_item_guard BEFORE INSERT OR UPDATE OR DELETE ON "quoteItem"
    FOR EACH ROW EXECUTE FUNCTION quote_item_guard();
