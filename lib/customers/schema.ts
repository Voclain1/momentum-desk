import { z } from "zod";
import { countryCode, currencyCode, language, locale } from "@/lib/organizations/settings";

/**
 * Validation for customer and contact input (spec §7.3). Forms submit empty
 * strings for blank fields; they are stored as null. Unknown fields are
 * rejected, never silently dropped.
 */

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);

/** Optional free text, trimmed, at most `max` characters. */
const text = (max: number) => z.preprocess(blankToNull, z.string().trim().max(max).nullable().default(null));
const optional = <T extends z.ZodType>(schema: T) => z.preprocess(blankToNull, schema.nullable().default(null));

const email = optional(z.string().trim().toLowerCase().pipe(z.email({ error: "must be a valid email address" })).pipe(z.string().max(254)));
const phone = optional(
  z
    .string()
    .trim()
    .max(40)
    .regex(/^\+?[0-9 ().-]{3,}$/, { error: "may contain digits, spaces, + ( ) . and - only" }),
);
const website = optional(
  z
    .string()
    .trim()
    .max(200)
    // Add https:// only when no scheme was given; "ftp://…" stays and fails below.
    .transform((value) => (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`))
    .pipe(z.url({ protocol: /^https?$/, error: "must be a web address" })),
);

/** Tags: trimmed, de-duplicated (case-insensitive), at most 20 of 40 characters. */
const tags = z.preprocess(
  (value) => (typeof value === "string" ? value.split(",") : (value ?? [])),
  z
    .array(z.string().trim().max(40, { error: "must be at most 40 characters each" }))
    .transform((list) => {
      const seen = new Set<string>();
      return list.filter((tag) => tag && !seen.has(tag.toLowerCase()) && seen.add(tag.toLowerCase()));
    })
    .pipe(z.array(z.string()).max(20, { error: "at most 20 tags" })),
);

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

/** Field name → message, from a failed parse. Messages never repeat the input. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = issue.code === "unrecognized_keys" ? issue.keys.join(", ") : String(issue.path[0] ?? "input");
    fields[field] ??= issue.code === "unrecognized_keys" ? "is not a known field" : issue.message;
  }
  return fields;
}
