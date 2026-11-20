-- CreateTable
CREATE TABLE "productEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "userId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "productEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "productEvent_organizationId_name_occurredAt_idx" ON "productEvent"("organizationId", "name", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "productEvent_organizationId_dedupeKey_key" ON "productEvent"("organizationId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "productEvent" ADD CONSTRAINT "productEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security (docs/tenant-isolation.md).
ALTER TABLE "productEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "productEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY "productEvent_tenant_isolation" ON "productEvent"
    USING ("organizationId" = app_current_organization_id())
    WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "productEvent"
    ADD CONSTRAINT "productEvent_name_check" CHECK ("name" IN (
        'lead_created', 'lead_qualified', 'opportunity_won', 'quote_created', 'quote_sent', 'quote_viewed',
        'quote_accepted', 'invoice_created', 'invoice_sent', 'invoice_viewed', 'payment_started',
        'payment_completed', 'invoice_overdue', 'reminder_sent', 'overdue_invoice_paid')),
    ADD CONSTRAINT "productEvent_entity_check" CHECK ("entityType" IN ('lead', 'quote', 'invoice', 'payment', 'paymentAttempt', 'reminder'));

-- A record of what happened: never edited.
CREATE FUNCTION "productEvent_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'productEvent is append-only';
END;
$$;
CREATE TRIGGER "productEvent_append_only" BEFORE UPDATE ON "productEvent"
    FOR EACH ROW EXECUTE FUNCTION "productEvent_append_only"();
