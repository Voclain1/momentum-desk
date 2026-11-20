-- AlterTable
ALTER TABLE "customer" ADD COLUMN     "erasedAt" TIMESTAMPTZ(3);

-- Erasure (D25) may clear visitors' addresses and browsers from document
-- evidence, and the address a sent reminder went to. Nothing else changes.
CREATE OR REPLACE FUNCTION "quoteEvent_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF pg_trigger_depth() > 1 THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    IF TG_OP = 'UPDATE' AND NEW."ipAddress" IS NULL AND NEW."userAgent" IS NULL
        AND (NEW."id", NEW."organizationId", NEW."quoteId", NEW."linkId", NEW."kind", NEW."name", NEW."email", NEW."reason", NEW."contentHash", NEW."createdAt")
        IS NOT DISTINCT FROM (OLD."id", OLD."organizationId", OLD."quoteId", OLD."linkId", OLD."kind", OLD."name", OLD."email", OLD."reason", OLD."contentHash", OLD."createdAt") THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'quoteEvent is append-only: % is not allowed', TG_OP USING ERRCODE = 'check_violation';
END;
$$;

CREATE OR REPLACE FUNCTION "invoiceEvent_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF pg_trigger_depth() > 1 THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    IF TG_OP = 'UPDATE' AND NEW."ipAddress" IS NULL AND NEW."userAgent" IS NULL
        AND (NEW."id", NEW."organizationId", NEW."invoiceId", NEW."linkId", NEW."kind", NEW."createdAt")
        IS NOT DISTINCT FROM (OLD."id", OLD."organizationId", OLD."invoiceId", OLD."linkId", OLD."kind", OLD."createdAt") THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'invoiceEvent is append-only: % is not allowed', TG_OP USING ERRCODE = 'check_violation';
END;
$$;

CREATE OR REPLACE FUNCTION reminder_execution_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF pg_trigger_depth() = 1 THEN
            RAISE EXCEPTION 'reminders are never deleted' USING ERRCODE = 'check_violation';
        END IF;
        RETURN OLD;
    END IF;
    -- Erasure: only the recipient's address is cleared.
    IF NEW."sentTo" IS NULL AND OLD."sentTo" IS NOT NULL
        AND (to_jsonb(NEW) - 'sentTo') = (to_jsonb(OLD) - 'sentTo') THEN
        RETURN NEW;
    END IF;
    IF OLD."status" <> 'queued' OR (NEW."invoiceId", NEW."offsetDays", NEW."tone", NEW."currency", NEW."createdAt")
        IS DISTINCT FROM (OLD."invoiceId", OLD."offsetDays", OLD."tone", OLD."currency", OLD."createdAt") THEN
        RAISE EXCEPTION 'reminder % was already %', OLD."id", OLD."status" USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;
