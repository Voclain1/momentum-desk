-- CreateTable
CREATE TABLE "invoiceSettings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "paymentInstructions" TEXT,
    "defaultDueDays" INTEGER NOT NULL DEFAULT 14,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoiceSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoiceSettings_organizationId_key" ON "invoiceSettings"("organizationId");

-- AddForeignKey
ALTER TABLE "invoiceSettings" ADD CONSTRAINT "invoiceSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invoiceSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoiceSettings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "invoiceSettings_tenant_isolation" ON "invoiceSettings"
    USING ("organizationId" = app_current_organization_id())
    WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "invoiceSettings"
    ADD CONSTRAINT "invoiceSettings_due_days_check" CHECK ("defaultDueDays" BETWEEN 0 AND 365);
