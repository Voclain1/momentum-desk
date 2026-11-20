-- AlterTable
ALTER TABLE "organization" ADD COLUMN     "closureRequestedAt" TIMESTAMPTZ(3),
ADD COLUMN     "deleteAfter" TIMESTAMPTZ(3);

ALTER TABLE "organization"
    ADD CONSTRAINT "organization_closure_check" CHECK (("closureRequestedAt" IS NULL) = ("deleteAfter" IS NULL));
