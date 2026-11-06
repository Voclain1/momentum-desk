import { listTeam } from "@/lib/auth/team";
import { SOURCE_LABELS } from "@/lib/leads/labels";
import { LEAD_SOURCES } from "@/lib/leads/schema";
import { listStages } from "@/lib/leads/service";
import { formatMoney, money } from "@/lib/money";
import { settingsOptions } from "@/lib/organizations/options";
import { tenantData } from "@/lib/tenant";

/** What every lead form needs: stages, members, sources and currencies. */
export async function leadFormData(organizationId: string) {
  const [stages, team] = await Promise.all([listStages(tenantData, organizationId), listTeam(organizationId)]);
  return {
    stages: stages.map(({ id, name, kind }) => ({ id, name, kind })),
    members: team.map(({ userId, name }) => ({ userId, name })),
    sources: LEAD_SOURCES.map((value) => ({ value, label: SOURCE_LABELS[value] })),
    currencies: settingsOptions().currencies,
  };
}

/** A lead's value in the workspace's locale, or null. */
export function formatValue(lead: { estimatedValueMinor: bigint | null; currency: string | null }, locale: string) {
  return lead.estimatedValueMinor !== null && lead.currency
    ? formatMoney(money(lead.estimatedValueMinor, lead.currency), locale)
    : null;
}
