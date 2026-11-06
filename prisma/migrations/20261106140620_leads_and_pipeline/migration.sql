-- CreateTable
CREATE TABLE "pipelineStage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipelineStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactName" TEXT,
    "companyName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "source" TEXT,
    "ownerUserId" TEXT,
    "stageId" TEXT NOT NULL,
    "estimatedValueMinor" BIGINT,
    "currency" TEXT,
    "summary" TEXT,
    "nextFollowUpOn" DATE,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "stageChangedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(3),
    "lostReason" TEXT,
    "archivedAt" TIMESTAMPTZ(3),
    "createdById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pipelineStage_organizationId_position_idx" ON "pipelineStage"("organizationId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "pipelineStage_id_organizationId_key" ON "pipelineStage"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "pipelineStage_organizationId_key_key" ON "pipelineStage"("organizationId", "key");

-- CreateIndex
CREATE INDEX "lead_organizationId_archivedAt_stageId_idx" ON "lead"("organizationId", "archivedAt", "stageId");

-- CreateIndex
CREATE INDEX "lead_organizationId_ownerUserId_idx" ON "lead"("organizationId", "ownerUserId");

-- CreateIndex
CREATE INDEX "lead_organizationId_nextFollowUpOn_idx" ON "lead"("organizationId", "nextFollowUpOn");

-- CreateIndex
CREATE INDEX "lead_organizationId_updatedAt_idx" ON "lead"("organizationId", "updatedAt");

-- AddForeignKey
ALTER TABLE "pipelineStage" ADD CONSTRAINT "pipelineStage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_stageId_organizationId_fkey" FOREIGN KEY ("stageId", "organizationId") REFERENCES "pipelineStage"("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Tenant isolation, as for auditLog (docs/tenant-isolation.md).
-- ---------------------------------------------------------------------------
ALTER TABLE "pipelineStage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pipelineStage" FORCE ROW LEVEL SECURITY;
CREATE POLICY "pipelineStage_tenant_isolation" ON "pipelineStage"
    USING ("organizationId" = app_current_organization_id())
    WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "lead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead" FORCE ROW LEVEL SECURITY;
CREATE POLICY "lead_tenant_isolation" ON "lead"
    USING ("organizationId" = app_current_organization_id())
    WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "pipelineStage"
    ADD CONSTRAINT "pipelineStage_kind_check" CHECK ("kind" IN ('open', 'won', 'lost')),
    ADD CONSTRAINT "pipelineStage_name_check" CHECK (length(btrim("name")) > 0),
    ADD CONSTRAINT "pipelineStage_position_check" CHECK ("position" >= 0);

-- The application validates the full rules (lib/leads).
ALTER TABLE "lead"
    ADD CONSTRAINT "lead_name_check" CHECK (
        length(btrim(coalesce("contactName", ''))) > 0 OR length(btrim(coalesce("companyName", ''))) > 0
    ),
    ADD CONSTRAINT "lead_email_check" CHECK ("email" = lower("email")),
    ADD CONSTRAINT "lead_source_check" CHECK (
        "source" IN ('website', 'referral', 'phone', 'email', 'walk_in', 'social', 'event', 'partner', 'other')
    ),
    -- An amount always travels with its currency (spec §5.3).
    ADD CONSTRAINT "lead_value_currency_check" CHECK (("estimatedValueMinor" IS NULL) = ("currency" IS NULL)),
    ADD CONSTRAINT "lead_value_check" CHECK ("estimatedValueMinor" >= 0),
    ADD CONSTRAINT "lead_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    ADD CONSTRAINT "lead_version_check" CHECK ("version" >= 1);
