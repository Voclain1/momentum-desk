-- CreateTable
CREATE TABLE "organizationBranding" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "logo" BYTEA,
    "logoType" TEXT,
    "logoHash" TEXT,
    "accentColor" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organizationBranding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizationBranding_organizationId_key" ON "organizationBranding"("organizationId");

-- AddForeignKey
ALTER TABLE "organizationBranding" ADD CONSTRAINT "organizationBranding_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security (docs/tenant-isolation.md).
ALTER TABLE "organizationBranding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organizationBranding" FORCE ROW LEVEL SECURITY;
CREATE POLICY "organizationBranding_tenant_isolation" ON "organizationBranding"
    USING ("organizationId" = app_current_organization_id())
    WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "organizationBranding"
    ADD CONSTRAINT "organizationBranding_logo_check" CHECK (
        ("logo" IS NULL AND "logoType" IS NULL AND "logoHash" IS NULL)
        OR ("logo" IS NOT NULL AND octet_length("logo") <= 262144
            AND "logoType" IN ('image/png', 'image/jpeg') AND "logoHash" ~ '^[0-9a-f]{16}$')),
    ADD CONSTRAINT "organizationBranding_accent_check" CHECK ("accentColor" IS NULL OR "accentColor" ~ '^#[0-9a-f]{6}$');
