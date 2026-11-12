import { z } from "zod";

/**
 * Field rules shared by customer, contact and lead forms. Forms submit empty
 * strings for blank fields; they become null.
 */

export const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);

/** Optional free text, trimmed, at most `max` characters. */
export const text = (max: number) => z.preprocess(blankToNull, z.string().trim().max(max).nullable().default(null));
export const optional = <T extends z.ZodType>(schema: T) => z.preprocess(blankToNull, schema.nullable().default(null));

export const email = optional(z.string().trim().toLowerCase().pipe(z.email({ error: "must be a valid email address" })).pipe(z.string().max(254)));
export const phone = optional(
  z
    .string()
    .trim()
    .max(40)
    .regex(/^\+?[0-9 ().-]{3,}$/, { error: "may contain digits, spaces, + ( ) . and - only" }),
);
export const website = optional(
  z
    .string()
    .trim()
    .max(200)
    // Add https:// only when no scheme was given; "ftp://…" stays and fails below.
    .transform((value) => (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`))
    .pipe(z.url({ protocol: /^https?$/, error: "must be a web address" })),
);

/** Tags: trimmed, de-duplicated (case-insensitive), at most 20 of 40 characters. */
export const tags = z.preprocess(
  (value) => (typeof value === "string" ? value.split(",") : (value ?? [])),
  z
    .array(z.string().trim().max(40, { error: "must be at most 40 characters each" }))
    .transform((list) => {
      const seen = new Set<string>();
      return list.filter((tag) => tag && !seen.has(tag.toLowerCase()) && seen.add(tag.toLowerCase()));
    })
    .pipe(z.array(z.string()).max(20, { error: "at most 20 tags" })),
);

/** A calendar date, "YYYY-MM-DD", that exists (no 31 February). */
export const calendarDate = optional(
  z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "must be a date" })
    .refine((value) => {
      const date = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
    }, { error: "must be a real date" })
    .transform((value) => new Date(`${value}T00:00:00Z`)),
);

/** Field name → message, from a failed parse. Messages never repeat the input. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = issue.code === "unrecognized_keys" ? issue.keys.join(", ") : String(issue.path[0] ?? "input");
    fields[field] ??= issue.code === "unrecognized_keys" ? "is not a known field" : issue.message;
  }
  return fields;
}
