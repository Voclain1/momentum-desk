-- AlterTable
ALTER TABLE "organization" ADD COLUMN     "settingsVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "organization"
    ADD CONSTRAINT "organization_settingsVersion_check" CHECK ("settingsVersion" >= 1);

-- The base currency is fixed once a workspace exists (spec §5.4: reports keep
-- their meaning). Rebasing will need an explicit migration with exchange-rate
-- history rules; until then the database refuses the change from any path.
CREATE FUNCTION "organization_base_currency_immutable"() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'organization.baseCurrency cannot be changed after the workspace is created'
        USING ERRCODE = 'check_violation';
END
$$;

CREATE TRIGGER "organization_base_currency_immutable"
    BEFORE UPDATE OF "baseCurrency" ON "organization"
    FOR EACH ROW
    WHEN (OLD."baseCurrency" IS DISTINCT FROM NEW."baseCurrency")
    EXECUTE FUNCTION "organization_base_currency_immutable"();
