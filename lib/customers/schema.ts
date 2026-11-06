import { z } from "zod";
import { countryCode, currencyCode, language, locale } from "@/lib/organizations/settings";
import { email, optional, phone, tags, text, website } from "@/lib/validation/fields";

export { fieldErrors } from "@/lib/validation/fields";

/**
 * Validation for customer and contact input (spec §7.3). Forms submit empty
 * strings for blank fields; they are stored as null. Unknown fields are
 * rejected, never silently dropped.
 */

export const CUSTOMER_TYPES = ["organization", "person"] as const;

export const customerInputSchema = z.strictObject({
  type: z.enum(CUSTOMER_TYPES, { error: "must be organization or person" }),
  displayName: z.string().trim().min(1, { error: "is required" }).max(200),
  legalName: text(200),
  email,
  phone,
  website,
  taxId: text(50),
  countryCode: optional(countryCode),
  addressLine1: text(200),
  addressLine2: text(200),
  city: text(100),
  region: text(100),
  postalCode: text(20),
  preferredLocale: optional(locale),
  preferredLanguage: optional(language),
  preferredCurrency: optional(currencyCode),
  tags,
  notes: text(5000),
});

export type CustomerInput = z.output<typeof customerInputSchema>;

export const contactInputSchema = z.strictObject({
  name: z.string().trim().min(1, { error: "is required" }).max(200),
  email,
  phone,
  jobTitle: text(100),
  isPrimary: z.preprocess((value) => value === true || value === "on" || value === "true", z.boolean()),
});

export type ContactInput = z.output<typeof contactInputSchema>;
