-- CreateTable
CREATE TABLE "job" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "runAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastError" TEXT,
    "lockedAt" TIMESTAMPTZ(3),
    "lockedBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_status_runAt_idx" ON "job"("status", "runAt");

-- CreateIndex
CREATE UNIQUE INDEX "job_organizationId_kind_key_key" ON "job"("organizationId", "kind", "key");

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "job" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job" FORCE ROW LEVEL SECURITY;
-- The app enqueues jobs for its own workspace, inside its own transaction.
CREATE POLICY "job_tenant_isolation" ON "job"
    USING ("organizationId" = app_current_organization_id())
    WITH CHECK ("organizationId" = app_current_organization_id());
-- The worker claims due jobs across workspaces (lib/jobs/queue-core.ts sets
-- this for its own transaction only); each job then runs as an ordinary
-- tenant transaction for its own workspace.
CREATE POLICY "job_worker_access" ON "job"
    USING (current_setting('app.job_worker', true) = 'on')
    WITH CHECK (current_setting('app.job_worker', true) = 'on');

ALTER TABLE "job"
    ADD CONSTRAINT "job_status_check" CHECK ("status" IN ('queued', 'running', 'succeeded', 'dead')),
    ADD CONSTRAINT "job_kind_check" CHECK ("kind" ~ '^[a-z]+(_[a-z]+)*(\.[a-z]+(_[a-z]+)*)+$'),
    ADD CONSTRAINT "job_attempts_check" CHECK ("attempts" >= 0 AND "maxAttempts" >= 1),
    ADD CONSTRAINT "job_key_check" CHECK (length("key") BETWEEN 1 AND 200);
