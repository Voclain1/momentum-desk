-- AlterTable
ALTER TABLE "customer" ADD COLUMN     "remindersOptOutBy" TEXT,
ADD COLUMN     "remindersOptedOutAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "invoiceSettings" ADD COLUMN     "reminderMinGapDays" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "remindersEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "reminderStep" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "offsetDays" INTEGER NOT NULL,
    "tone" TEXT NOT NULL,

    CONSTRAINT "reminderStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminderExecution" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "offsetDays" INTEGER NOT NULL,
    "tone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "reason" TEXT,
    "amountMinor" BIGINT,
    "currency" TEXT NOT NULL,
    "sentTo" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "reminderExecution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reminderStep_organizationId_offsetDays_key" ON "reminderStep"("organizationId", "offsetDays");

-- CreateIndex
CREATE INDEX "reminderExecution_organizationId_invoiceId_createdAt_idx" ON "reminderExecution"("organizationId", "invoiceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "reminderExecution_invoiceId_offsetDays_key" ON "reminderExecution"("invoiceId", "offsetDays");

-- AddForeignKey
ALTER TABLE "reminderStep" ADD CONSTRAINT "reminderStep_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminderExecution" ADD CONSTRAINT "reminderExecution_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminderExecution" ADD CONSTRAINT "reminderExecution_invoiceId_organizationId_fkey" FOREIGN KEY ("invoiceId", "organizationId") REFERENCES "invoice"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reminderStep" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reminderStep" FORCE ROW LEVEL SECURITY;
CREATE POLICY "reminderStep_tenant_isolation" ON "reminderStep"
    USING ("organizationId" = app_current_organization_id())
    WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "reminderExecution" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reminderExecution" FORCE ROW LEVEL SECURITY;
CREATE POLICY "reminderExecution_tenant_isolation" ON "reminderExecution"
    USING ("organizationId" = app_current_organization_id())
    WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "reminderStep"
    ADD CONSTRAINT "reminderStep_offset_check" CHECK ("offsetDays" BETWEEN -30 AND 180),
    ADD CONSTRAINT "reminderStep_tone_check" CHECK ("tone" IN ('friendly', 'firm', 'final'));

ALTER TABLE "reminderExecution"
    ADD CONSTRAINT "reminderExecution_status_check" CHECK ("status" IN ('queued', 'sent', 'skipped')),
    ADD CONSTRAINT "reminderExecution_tone_check" CHECK ("tone" IN ('friendly', 'firm', 'final')),
    ADD CONSTRAINT "reminderExecution_done_check" CHECK (("status" = 'queued') = ("completedAt" IS NULL)),
    ADD CONSTRAINT "reminderExecution_sent_check" CHECK (("status" = 'sent') = ("sentTo" IS NOT NULL AND "amountMinor" IS NOT NULL)),
    ADD CONSTRAINT "reminderExecution_skipped_check" CHECK (("status" = 'skipped') = ("reason" IS NOT NULL));

ALTER TABLE "invoiceSettings"
    ADD CONSTRAINT "invoiceSettings_reminder_gap_check" CHECK ("reminderMinGapDays" BETWEEN 1 AND 30);

ALTER TABLE "customer"
    ADD CONSTRAINT "customer_opt_out_check" CHECK (
        ("remindersOptedOutAt" IS NULL) = ("remindersOptOutBy" IS NULL)
        AND ("remindersOptOutBy" IS NULL OR "remindersOptOutBy" IN ('customer', 'staff')));

-- A reminder is history: once sent or skipped it never changes.
CREATE FUNCTION reminder_execution_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF pg_trigger_depth() = 1 THEN
            RAISE EXCEPTION 'reminders are never deleted' USING ERRCODE = 'check_violation';
        END IF;
        RETURN OLD;
    END IF;
    IF OLD."status" <> 'queued' OR (NEW."invoiceId", NEW."offsetDays", NEW."tone", NEW."currency", NEW."createdAt")
        IS DISTINCT FROM (OLD."invoiceId", OLD."offsetDays", OLD."tone", OLD."currency", OLD."createdAt") THEN
        RAISE EXCEPTION 'reminder % was already %', OLD."id", OLD."status" USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER reminder_execution_guard BEFORE UPDATE OR DELETE ON "reminderExecution"
    FOR EACH ROW EXECUTE FUNCTION reminder_execution_guard();
