-- AlterTable
ALTER TABLE "payment" ADD COLUMN     "attemptId" TEXT,
ADD COLUMN     "connectionId" TEXT,
ADD COLUMN     "providerReference" TEXT;

-- CreateTable
CREATE TABLE "providerConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "secretKeyEnc" TEXT NOT NULL,
    "webhookSecretEnc" TEXT,
    "keyHint" TEXT NOT NULL,
    "currencies" TEXT[],
    "connectedById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" TIMESTAMPTZ(3),

    CONSTRAINT "providerConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paymentAttempt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'created',
    "sessionId" TEXT,
    "payerEmail" TEXT,
    "paymentId" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "paymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "providerEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "attemptId" TEXT,
    "outcome" TEXT NOT NULL,
    "detail" TEXT,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "providerEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "providerConnection_organizationId_provider_idx" ON "providerConnection"("organizationId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "providerConnection_id_organizationId_key" ON "providerConnection"("id", "organizationId");

-- CreateIndex
CREATE INDEX "paymentAttempt_organizationId_invoiceId_createdAt_idx" ON "paymentAttempt"("organizationId", "invoiceId", "createdAt");

-- CreateIndex
CREATE INDEX "paymentAttempt_organizationId_sessionId_idx" ON "paymentAttempt"("organizationId", "sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "paymentAttempt_id_organizationId_key" ON "paymentAttempt"("id", "organizationId");

-- CreateIndex
CREATE INDEX "providerEvent_organizationId_receivedAt_idx" ON "providerEvent"("organizationId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "providerEvent_connectionId_eventId_key" ON "providerEvent"("connectionId", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_organizationId_providerReference_key" ON "payment"("organizationId", "providerReference");

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_connectionId_organizationId_fkey" FOREIGN KEY ("connectionId", "organizationId") REFERENCES "providerConnection"("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "providerConnection" ADD CONSTRAINT "providerConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "providerConnection" ADD CONSTRAINT "providerConnection_connectedById_fkey" FOREIGN KEY ("connectedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paymentAttempt" ADD CONSTRAINT "paymentAttempt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paymentAttempt" ADD CONSTRAINT "paymentAttempt_invoiceId_organizationId_fkey" FOREIGN KEY ("invoiceId", "organizationId") REFERENCES "invoice"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paymentAttempt" ADD CONSTRAINT "paymentAttempt_connectionId_organizationId_fkey" FOREIGN KEY ("connectionId", "organizationId") REFERENCES "providerConnection"("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "providerEvent" ADD CONSTRAINT "providerEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "providerEvent" ADD CONSTRAINT "providerEvent_connectionId_organizationId_fkey" FOREIGN KEY ("connectionId", "organizationId") REFERENCES "providerConnection"("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Tenant isolation, as for auditLog (docs/tenant-isolation.md).
-- ---------------------------------------------------------------------------
ALTER TABLE "providerConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "providerConnection" FORCE ROW LEVEL SECURITY;
CREATE POLICY "providerConnection_tenant_isolation" ON "providerConnection"
    USING ("organizationId" = app_current_organization_id())
    WITH CHECK ("organizationId" = app_current_organization_id());
-- A provider's webhook arrives without a session at /api/webhooks/{provider}/{id}.
-- It may read that one connection row (to check the signature with its
-- secret) by setting the id for its own transaction (lib/tenant/public.ts).
CREATE POLICY "providerConnection_webhook_lookup" ON "providerConnection" FOR SELECT
    USING ("id" = current_setting('app.provider_connection_id', true));

ALTER TABLE "paymentAttempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "paymentAttempt" FORCE ROW LEVEL SECURITY;
CREATE POLICY "paymentAttempt_tenant_isolation" ON "paymentAttempt"
    USING ("organizationId" = app_current_organization_id())
    WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "providerEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "providerEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY "providerEvent_tenant_isolation" ON "providerEvent"
    USING ("organizationId" = app_current_organization_id())
    WITH CHECK ("organizationId" = app_current_organization_id());

-- ---------------------------------------------------------------------------
-- Checks
-- ---------------------------------------------------------------------------
ALTER TABLE "providerConnection"
    ADD CONSTRAINT "providerConnection_provider_check" CHECK ("provider" IN ('paystack', 'stripe', 'bachs')),
    ADD CONSTRAINT "providerConnection_mode_check" CHECK ("mode" IN ('test', 'live', 'unknown')),
    ADD CONSTRAINT "providerConnection_secret_check" CHECK ("secretKeyEnc" LIKE 'v1.%');
-- One active connection per provider per workspace.
CREATE UNIQUE INDEX "providerConnection_active_key" ON "providerConnection" ("organizationId", "provider") WHERE "disconnectedAt" IS NULL;

ALTER TABLE "paymentAttempt"
    ADD CONSTRAINT "paymentAttempt_status_check" CHECK ("status" IN ('created', 'pending', 'succeeded', 'failed')),
    ADD CONSTRAINT "paymentAttempt_amount_check" CHECK ("amountMinor" > 0),
    ADD CONSTRAINT "paymentAttempt_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    ADD CONSTRAINT "paymentAttempt_paid_check" CHECK (("status" = 'succeeded') = ("paymentId" IS NOT NULL));

ALTER TABLE "providerEvent"
    ADD CONSTRAINT "providerEvent_outcome_check" CHECK ("outcome" IN ('recorded', 'already_recorded', 'pending', 'failed', 'ignored', 'refused'));

ALTER TABLE "payment"
    DROP CONSTRAINT "payment_method_check",
    ADD CONSTRAINT "payment_method_check" CHECK ("method" IN ('bank_transfer', 'cash', 'card', 'mobile_money', 'cheque', 'other')),
    ADD CONSTRAINT "payment_source_check" CHECK ("source" IN ('manual', 'paystack', 'stripe', 'bachs')),
    -- A provider payment always names its connection and reference; a manual one never does.
    ADD CONSTRAINT "payment_provider_check" CHECK (
        ("source" = 'manual') = ("providerReference" IS NULL) AND ("source" = 'manual') = ("connectionId" IS NULL));

-- Provider events are an append-only record.
CREATE FUNCTION "providerEvent_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF pg_trigger_depth() > 1 THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    RAISE EXCEPTION 'providerEvent is append-only: % is not allowed', TG_OP USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER "providerEvent_append_only"
    BEFORE UPDATE OR DELETE ON "providerEvent"
    FOR EACH ROW EXECUTE FUNCTION "providerEvent_append_only"();

-- Payments stay immutable with the new provider columns too.
CREATE OR REPLACE FUNCTION payment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF pg_trigger_depth() = 1 THEN
            RAISE EXCEPTION 'payments are never deleted; void it instead' USING ERRCODE = 'check_violation';
        END IF;
        RETURN OLD;
    END IF;
    IF (NEW."customerId", NEW."currency", NEW."amountMinor", NEW."method", NEW."source", NEW."receivedOn", NEW."reference",
        NEW."note", NEW."recordedById", NEW."connectionId", NEW."providerReference", NEW."attemptId", NEW."createdAt")
       IS DISTINCT FROM
       (OLD."customerId", OLD."currency", OLD."amountMinor", OLD."method", OLD."source", OLD."receivedOn", OLD."reference",
        OLD."note", OLD."recordedById", OLD."connectionId", OLD."providerReference", OLD."attemptId", OLD."createdAt")
       OR OLD."voidedAt" IS NOT NULL THEN
        RAISE EXCEPTION 'payment % cannot change; void it instead', OLD."id" USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

-- A payment can never be allocated beyond its amount; what is left over
-- stays visible as unallocated (D36).
CREATE OR REPLACE FUNCTION payment_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    inv record;
    pay record;
    allocated bigint;
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
    SELECT "currency", "customerId", "voidedAt", "amountMinor" INTO pay FROM "payment"
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
    SELECT COALESCE(SUM("amountMinor"), 0) INTO allocated FROM "paymentAllocation"
        WHERE "paymentId" = NEW."paymentId" AND "organizationId" = NEW."organizationId" AND "voidedAt" IS NULL;
    IF allocated + NEW."amountMinor" > pay."amountMinor" THEN
        RAISE EXCEPTION 'a payment cannot be allocated beyond its amount' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;
