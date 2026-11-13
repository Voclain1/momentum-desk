-- CreateTable
CREATE TABLE "refund" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "providerReference" TEXT,
    "allocationReducedMinor" BIGINT NOT NULL DEFAULT 0,
    "invoiceId" TEXT,
    "requestedById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),
    "failureReason" TEXT,

    CONSTRAINT "refund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "refund_organizationId_paymentId_idx" ON "refund"("organizationId", "paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "refund_organizationId_providerReference_key" ON "refund"("organizationId", "providerReference");

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_paymentId_organizationId_fkey" FOREIGN KEY ("paymentId", "organizationId") REFERENCES "payment"("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "refund" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refund" FORCE ROW LEVEL SECURITY;
CREATE POLICY "refund_tenant_isolation" ON "refund"
    USING ("organizationId" = app_current_organization_id())
    WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "refund"
    ADD CONSTRAINT "refund_amount_check" CHECK ("amountMinor" > 0 AND "allocationReducedMinor" BETWEEN 0 AND "amountMinor"),
    ADD CONSTRAINT "refund_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    ADD CONSTRAINT "refund_method_check" CHECK ("method" IN ('provider', 'manual')),
    ADD CONSTRAINT "refund_status_check" CHECK ("status" IN ('pending', 'succeeded', 'failed')),
    ADD CONSTRAINT "refund_completed_check" CHECK (("status" = 'pending') = ("completedAt" IS NULL)),
    ADD CONSTRAINT "refund_reason_check" CHECK (length(btrim("reason")) >= 3);

-- What a payment can still give: its amount less refunds that have not failed.
CREATE FUNCTION payment_refundable(payment_id text, organization_id text) RETURNS bigint LANGUAGE sql STABLE AS $$
    SELECT p."amountMinor" - COALESCE((
        SELECT SUM(r."amountMinor") FROM "refund" r
        WHERE r."paymentId" = p."id" AND r."organizationId" = p."organizationId" AND r."status" <> 'failed'
    ), 0)
    FROM "payment" p WHERE p."id" = payment_id AND p."organizationId" = organization_id;
$$;

-- Refunds: in the payment's currency, never more than is left of it, and
-- afterwards only pending → succeeded or failed (D37).
CREATE FUNCTION refund_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    pay record;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF pg_trigger_depth() = 1 THEN
            RAISE EXCEPTION 'refunds are never deleted' USING ERRCODE = 'check_violation';
        END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF (NEW."paymentId", NEW."amountMinor", NEW."currency", NEW."method", NEW."reason", NEW."providerReference",
            NEW."allocationReducedMinor", NEW."invoiceId", NEW."requestedById", NEW."createdAt")
           IS DISTINCT FROM
           (OLD."paymentId", OLD."amountMinor", OLD."currency", OLD."method", OLD."reason", OLD."providerReference",
            OLD."allocationReducedMinor", OLD."invoiceId", OLD."requestedById", OLD."createdAt")
           OR OLD."status" <> 'pending' OR NEW."status" NOT IN ('succeeded', 'failed') THEN
            RAISE EXCEPTION 'refund % can only go from pending to succeeded or failed', OLD."id" USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;
    SELECT "currency", "voidedAt" INTO pay FROM "payment" WHERE "id" = NEW."paymentId" AND "organizationId" = NEW."organizationId";
    IF pay."voidedAt" IS NOT NULL THEN
        RAISE EXCEPTION 'a voided payment cannot be refunded' USING ERRCODE = 'check_violation';
    END IF;
    IF pay."currency" <> NEW."currency" THEN
        RAISE EXCEPTION 'a refund is in its payment''s currency' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."status" <> 'failed' AND NEW."amountMinor" > payment_refundable(NEW."paymentId", NEW."organizationId") THEN
        RAISE EXCEPTION 'a refund cannot exceed what is left of the payment' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER refund_guard BEFORE INSERT OR UPDATE OR DELETE ON "refund"
    FOR EACH ROW EXECUTE FUNCTION refund_guard();

-- Allocations are now limited by what is left of the payment after refunds.
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
    SELECT COALESCE(SUM("amountMinor"), 0) INTO allocated FROM "paymentAllocation"
        WHERE "paymentId" = NEW."paymentId" AND "organizationId" = NEW."organizationId" AND "voidedAt" IS NULL;
    IF allocated + NEW."amountMinor" > payment_refundable(NEW."paymentId", NEW."organizationId") THEN
        RAISE EXCEPTION 'a payment cannot be allocated beyond its amount less refunds' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

-- A refunded payment was real money: it is never voided as a mistake.
CREATE FUNCTION payment_void_refunded() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM "refund" r WHERE r."paymentId" = NEW."id" AND r."organizationId" = NEW."organizationId" AND r."status" <> 'failed') THEN
        RAISE EXCEPTION 'payment % has refunds, so it cannot be voided', NEW."id" USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER payment_void_refunded BEFORE UPDATE OF "voidedAt" ON "payment"
    FOR EACH ROW WHEN (OLD."voidedAt" IS NULL AND NEW."voidedAt" IS NOT NULL)
    EXECUTE FUNCTION payment_void_refunded();
