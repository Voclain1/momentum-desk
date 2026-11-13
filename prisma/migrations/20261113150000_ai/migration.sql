-- CreateTable
CREATE TABLE "aiSettings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "monthlyLimit" INTEGER,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "aiSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aiInteraction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "task" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costMicros" BIGINT,
    "errorCode" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "aiInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "aiSettings_organizationId_key" ON "aiSettings"("organizationId");

-- CreateIndex
CREATE INDEX "aiInteraction_organizationId_period_idx" ON "aiInteraction"("organizationId", "period");

-- AddForeignKey
ALTER TABLE "aiSettings" ADD CONSTRAINT "aiSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aiInteraction" ADD CONSTRAINT "aiInteraction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aiInteraction" ADD CONSTRAINT "aiInteraction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-level security (docs/tenant-isolation.md).
ALTER TABLE "aiSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "aiSettings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "aiSettings_tenant_isolation" ON "aiSettings"
    USING ("organizationId" = app_current_organization_id())
    WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "aiInteraction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "aiInteraction" FORCE ROW LEVEL SECURITY;
CREATE POLICY "aiInteraction_tenant_isolation" ON "aiInteraction"
    USING ("organizationId" = app_current_organization_id())
    WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "aiSettings"
    ADD CONSTRAINT "aiSettings_limit_check" CHECK ("monthlyLimit" IS NULL OR "monthlyLimit" >= 0);

ALTER TABLE "aiInteraction"
    ADD CONSTRAINT "aiInteraction_task_check" CHECK ("task" ~ '^[a-z]+(\.[a-z_]+)+$'),
    ADD CONSTRAINT "aiInteraction_period_check" CHECK ("period" ~ '^[0-9]{4}-[0-9]{2}$'),
    ADD CONSTRAINT "aiInteraction_provider_check" CHECK ("provider" IN ('anthropic', 'openai')),
    ADD CONSTRAINT "aiInteraction_status_check" CHECK ("status" IN ('pending', 'ok', 'rejected', 'refused', 'error')),
    ADD CONSTRAINT "aiInteraction_tokens_check" CHECK ("inputTokens" >= 0 AND "outputTokens" >= 0 AND ("costMicros" IS NULL OR "costMicros" >= 0)),
    ADD CONSTRAINT "aiInteraction_finished_check" CHECK (("status" = 'pending') = ("finishedAt" IS NULL));
