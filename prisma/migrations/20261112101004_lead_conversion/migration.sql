-- AlterTable
ALTER TABLE "lead" ADD COLUMN     "convertedAt" TIMESTAMPTZ(3),
ADD COLUMN     "customerId" TEXT;

-- CreateIndex
CREATE INDEX "lead_organizationId_customerId_idx" ON "lead"("organizationId", "customerId");

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "customer"("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- A converted lead always names its customer.
ALTER TABLE "lead"
    ADD CONSTRAINT "lead_conversion_check" CHECK ("convertedAt" IS NULL OR "customerId" IS NOT NULL);
