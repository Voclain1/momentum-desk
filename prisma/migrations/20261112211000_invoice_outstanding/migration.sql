-- AlterTable
ALTER TABLE "invoice" ADD COLUMN     "outstandingMinor" BIGINT NOT NULL DEFAULT 0;

-- outstandingMinor is derived, never written by the app: whatever is sent,
-- the database sets it to total − paid on every insert and update.
CREATE FUNCTION invoice_outstanding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW."outstandingMinor" := NEW."totalMinor" - NEW."paidMinor";
    RETURN NEW;
END;
$$;

CREATE TRIGGER invoice_outstanding BEFORE INSERT OR UPDATE ON "invoice"
    FOR EACH ROW EXECUTE FUNCTION invoice_outstanding();
