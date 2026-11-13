-- A provider refund is recorded before the provider is asked (so the amount
-- is reserved), then given the provider's refund id once it answers.
CREATE OR REPLACE FUNCTION refund_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
        IF (NEW."paymentId", NEW."amountMinor", NEW."currency", NEW."method", NEW."reason",
            NEW."allocationReducedMinor", NEW."invoiceId", NEW."requestedById", NEW."createdAt")
           IS DISTINCT FROM
           (OLD."paymentId", OLD."amountMinor", OLD."currency", OLD."method", OLD."reason",
            OLD."allocationReducedMinor", OLD."invoiceId", OLD."requestedById", OLD."createdAt")
           OR (OLD."providerReference" IS NOT NULL AND NEW."providerReference" IS DISTINCT FROM OLD."providerReference")
           OR OLD."status" <> 'pending' THEN
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
