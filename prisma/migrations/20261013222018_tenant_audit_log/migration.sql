-- CreateTable
CREATE TABLE "auditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auditLog_organizationId_createdAt_idx" ON "auditLog"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "auditLog" ADD CONSTRAINT "auditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditLog" ADD CONSTRAINT "auditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Tenant isolation (docs/tenant-isolation.md). The app sets
-- app.organization_id for the current transaction (lib/tenant); rows of any
-- other organization are invisible and cannot be written. With no setting,
-- no rows are visible. FORCE makes the policy apply to the table owner too;
-- superusers and BYPASSRLS roles still skip it, so the app must connect as a
-- restricted role (prisma/sql/app-role.sql).
-- ---------------------------------------------------------------------------
CREATE FUNCTION app_current_organization_id() RETURNS text
    LANGUAGE sql STABLE
    AS $$ SELECT NULLIF(current_setting('app.organization_id', true), '') $$;

ALTER TABLE "auditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "auditLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY "auditLog_tenant_isolation" ON "auditLog"
    USING ("organizationId" = app_current_organization_id())
    WITH CHECK ("organizationId" = app_current_organization_id());

-- Append-only: reject direct UPDATE and DELETE. Changes made by foreign-key
-- actions (deleting the organization, or the actor's account) run one
-- trigger level deeper and are allowed.
CREATE FUNCTION "auditLog_append_only"() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF pg_trigger_depth() > 1 THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;
    RAISE EXCEPTION 'auditLog is append-only: % is not allowed', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER "auditLog_append_only"
    BEFORE UPDATE OR DELETE ON "auditLog"
    FOR EACH ROW EXECUTE FUNCTION "auditLog_append_only"();

ALTER TABLE "auditLog"
    ADD CONSTRAINT "auditLog_action_check" CHECK ("action" ~ '^[a-z]+(_[a-z]+)*(\.[a-z]+(_[a-z]+)*)+$');
