-- CreateTable
CREATE TABLE "invoiceLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "invoiceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoiceEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "linkId" TEXT,
    "kind" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoiceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoiceLink_tokenHash_key" ON "invoiceLink"("tokenHash");

-- CreateIndex
CREATE INDEX "invoiceLink_organizationId_invoiceId_idx" ON "invoiceLink"("organizationId", "invoiceId");

-- CreateIndex
CREATE INDEX "invoiceEvent_organizationId_invoiceId_createdAt_idx" ON "invoiceEvent"("organizationId", "invoiceId", "createdAt");

-- AddForeignKey
ALTER TABLE "invoiceLink" ADD CONSTRAINT "invoiceLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoiceLink" ADD CONSTRAINT "invoiceLink_invoiceId_organizationId_fkey" FOREIGN KEY ("invoiceId", "organizationId") REFERENCES "invoice"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoiceLink" ADD CONSTRAINT "invoiceLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoiceEvent" ADD CONSTRAINT "invoiceEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoiceEvent" ADD CONSTRAINT "invoiceEvent_invoiceId_organizationId_fkey" FOREIGN KEY ("invoiceId", "organizationId") REFERENCES "invoice"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invoiceLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoiceLink" FORCE ROW LEVEL SECURITY;
CREATE POLICY "invoiceLink_tenant_isolation" ON "invoiceLink"
    USING ("organizationId" = app_current_organization_id())
    WITH CHECK ("organizationId" = app_current_organization_id());
-- As for quote links: a visitor without a session reads only the link whose
-- token hash it set for its own transaction (lib/tenant/public.ts).
CREATE POLICY "invoiceLink_token_lookup" ON "invoiceLink" FOR SELECT
    USING ("tokenHash" = current_setting('app.invoice_token_hash', true));

ALTER TABLE "invoiceEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoiceEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY "invoiceEvent_tenant_isolation" ON "invoiceEvent"
    USING ("organizationId" = app_current_organization_id())
    WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "invoiceLink"
    ADD CONSTRAINT "invoiceLink_token_hash_check" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "invoiceEvent"
    ADD CONSTRAINT "invoiceEvent_kind_check" CHECK ("kind" IN ('viewed'));

CREATE FUNCTION "invoiceEvent_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF pg_trigger_depth() > 1 THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    RAISE EXCEPTION 'invoiceEvent is append-only: % is not allowed', TG_OP USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER "invoiceEvent_append_only"
    BEFORE UPDATE OR DELETE ON "invoiceEvent"
    FOR EACH ROW EXECUTE FUNCTION "invoiceEvent_append_only"();
