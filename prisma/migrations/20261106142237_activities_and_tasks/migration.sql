-- CreateTable
CREATE TABLE "activity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "leadId" TEXT,
    "customerId" TEXT,
    "authorUserId" TEXT,
    "editedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "dueOn" DATE,
    "assigneeUserId" TEXT,
    "leadId" TEXT,
    "customerId" TEXT,
    "completedAt" TIMESTAMPTZ(3),
    "completedById" TEXT,
    "createdById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "task_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activity_organizationId_leadId_occurredAt_idx" ON "activity"("organizationId", "leadId", "occurredAt");

-- CreateIndex
CREATE INDEX "activity_organizationId_customerId_occurredAt_idx" ON "activity"("organizationId", "customerId", "occurredAt");

-- CreateIndex
CREATE INDEX "task_organizationId_completedAt_dueOn_idx" ON "task"("organizationId", "completedAt", "dueOn");

-- CreateIndex
CREATE INDEX "task_organizationId_assigneeUserId_completedAt_idx" ON "task"("organizationId", "assigneeUserId", "completedAt");

-- CreateIndex
CREATE INDEX "task_organizationId_leadId_idx" ON "task"("organizationId", "leadId");

-- CreateIndex
CREATE INDEX "task_organizationId_customerId_idx" ON "task"("organizationId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "lead_id_organizationId_key" ON "lead"("id", "organizationId");

-- AddForeignKey
ALTER TABLE "activity" ADD CONSTRAINT "activity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity" ADD CONSTRAINT "activity_leadId_organizationId_fkey" FOREIGN KEY ("leadId", "organizationId") REFERENCES "lead"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity" ADD CONSTRAINT "activity_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "customer"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity" ADD CONSTRAINT "activity_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_leadId_organizationId_fkey" FOREIGN KEY ("leadId", "organizationId") REFERENCES "lead"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "customer"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Tenant isolation, as for auditLog (docs/tenant-isolation.md).
-- ---------------------------------------------------------------------------
ALTER TABLE "activity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "activity" FORCE ROW LEVEL SECURITY;
CREATE POLICY "activity_tenant_isolation" ON "activity"
    USING ("organizationId" = app_current_organization_id())
    WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "task" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task" FORCE ROW LEVEL SECURITY;
CREATE POLICY "task_tenant_isolation" ON "task"
    USING ("organizationId" = app_current_organization_id())
    WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "activity"
    ADD CONSTRAINT "activity_kind_check" CHECK ("kind" IN ('note', 'call', 'email', 'meeting', 'message')),
    ADD CONSTRAINT "activity_body_check" CHECK (length(btrim("body")) > 0),
    -- About exactly one record.
    ADD CONSTRAINT "activity_parent_check" CHECK (num_nonnulls("leadId", "customerId") = 1);

ALTER TABLE "task"
    ADD CONSTRAINT "task_title_check" CHECK (length(btrim("title")) > 0),
    -- About at most one record; none for a standalone task.
    ADD CONSTRAINT "task_parent_check" CHECK (num_nonnulls("leadId", "customerId") <= 1),
    -- Who completed it is recorded only for a completed task.
    ADD CONSTRAINT "task_completion_check" CHECK ("completedById" IS NULL OR "completedAt" IS NOT NULL),
    ADD CONSTRAINT "task_version_check" CHECK ("version" >= 1);
