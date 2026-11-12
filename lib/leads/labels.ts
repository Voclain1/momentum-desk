import type { LeadSource } from "./schema";

export const SOURCE_LABELS: Record<LeadSource, string> = {
  website: "Website",
  referral: "Referral",
  phone: "Phone call",
  email: "Email",
  walk_in: "Walk-in",
  social: "Social media",
  event: "Event",
  partner: "Partner",
  other: "Other",
};

/** "Ada Obi · Acme Solar", or whichever of the two is present. */
export function leadName(lead: { contactName: string | null; companyName: string | null }): string {
  return [lead.contactName, lead.companyName].filter(Boolean).join(" · ") || "Unnamed lead";
}
