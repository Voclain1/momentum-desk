-- CreateTable
CREATE TABLE "quoteLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "quoteLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quoteEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "linkId" TEXT,
    "kind" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "reason" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "contentHash" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quoteEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quoteAcceptanceCode" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quoteAcceptanceCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quoteLink_tokenHash_key" ON "quoteLink"("tokenHash");

-- CreateIndex
CREATE INDEX "quoteLink_organizationId_quoteId_idx" ON "quoteLink"("organizationId", "quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "quoteLink_id_organizationId_key" ON "quoteLink"("id", "organizationId");

-- CreateIndex
CREATE INDEX "quoteEvent_organizationId_quoteId_createdAt_idx" ON "quoteEvent"("organizationId", "quoteId", "createdAt");

-- CreateIndex
CREATE INDEX "quoteAcceptanceCode_organizationId_quoteId_createdAt_idx" ON "quoteAcceptanceCode"("organizationId", "quoteId", "createdAt");

-- AddForeignKey
ALTER TABLE "quoteLink" ADD CONSTRAINT "quoteLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quoteLink" ADD CONSTRAINT "quoteLink_quoteId_organizationId_fkey" FOREIGN KEY ("quoteId", "organizationId") REFERENCES "quote"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quoteLink" ADD CONSTRAINT "quoteLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quoteEvent" ADD CONSTRAINT "quoteEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quoteEvent" ADD CONSTRAINT "quoteEvent_quoteId_organizationId_fkey" FOREIGN KEY ("quoteId", "organizationId") REFERENCES "quote"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quoteAcceptanceCode" ADD CONSTRAINT "quoteAcceptanceCode_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quoteAcceptanceCode" ADD CONSTRAINT "quoteAcceptanceCode_quoteId_organizationId_fkey" FOREIGN KEY ("quoteId", "organizationId") REFERENCES "quote"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quoteAcceptanceCode" ADD CONSTRAINT "quoteAcceptanceCode_linkId_organizationId_fkey" FOREIGN KEY ("linkId", "organizationId") REFERENCES "quoteLink"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Tenant isolation, as for auditLog (docs/tenant-isolation.md).
-- ---------------------------------------------------------------------------
ALTER TABLE "quoteLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quoteLink" FORCE ROW LEVEL SECURITY;
CREATE POLICY "quoteLink_tenant_isolation" ON "quoteLink"
    USING ("organizationId" = app_current_organization_id())
    WITH CHECK ("organizationId" = app_current_organization_id());
-- The public page (/q/{token}) has no session. It may read one link row: the
-- one whose token hash it set for its own transaction (lib/tenant/public.ts).
-- Read-only, one row, and only for someone holding the token.
CREATE POLICY "quoteLink_token_lookup" ON "quoteLink" FOR SELECT
    USING ("tokenHash" = current_setting('app.quote_token_hash', true));

ALTER TABLE "quoteEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quoteEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY "quoteEvent_tenant_isolation" ON "quoteEvent"
    USING ("organizationId" = app_current_organization_id())
    WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "quoteAcceptanceCode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quoteAcceptanceCode" FORCE ROW LEVEL SECURITY;
CREATE POLICY "quoteAcceptanceCode_tenant_isolation" ON "quoteAcceptanceCode"
    USING ("organizationId" = app_current_organization_id())
    WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "quoteLink"
    ADD CONSTRAINT "quoteLink_token_hash_check" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "quoteEvent"
    ADD CONSTRAINT "quoteEvent_kind_check" CHECK ("kind" IN ('viewed', 'code_sent', 'accepted', 'rejected')),
    ADD CONSTRAINT "quoteEvent_accepted_check" CHECK (
        "kind" <> 'accepted' OR ("name" IS NOT NULL AND "email" IS NOT NULL AND "contentHash" IS NOT NULL));

ALTER TABLE "quoteAcceptanceCode"
    ADD CONSTRAINT "quoteAcceptanceCode_hash_check" CHECK ("codeHash" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "quoteAcceptanceCode_attempts_check" CHECK ("attempts" >= 0);

-- Evidence is append-only, like auditLog: no direct UPDATE or DELETE.
CREATE FUNCTION "quoteEvent_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF pg_trigger_depth() > 1 THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    RAISE EXCEPTION 'quoteEvent is append-only: % is not allowed', TG_OP USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER "quoteEvent_append_only"
    BEFORE UPDATE OR DELETE ON "quoteEvent"
    FOR EACH ROW EXECUTE FUNCTION "quoteEvent_append_only"();
