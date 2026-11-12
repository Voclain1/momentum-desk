import { z } from "zod";
import { optional } from "@/lib/validation/fields";

export { fieldErrors } from "@/lib/validation/fields";

export const ACTIVITY_KINDS = ["note", "call", "email", "meeting", "message"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/**
 * A note or logged interaction. `occurredAt` is wall-clock time in the
 * workspace's timezone ("YYYY-MM-DDTHH:mm", from a datetime-local input);
 * blank means now. The service converts it to an instant.
 */
export const activityInputSchema = z.strictObject({
  kind: z.enum(ACTIVITY_KINDS, { error: "must be a note, call, email, meeting or message" }),
  body: z.string().trim().min(1, { error: "is required" }).max(10000),
  occurredAt: optional(z.string().trim().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, { error: "must be a date and time" })),
});

export type ActivityInput = z.output<typeof activityInputSchema>;
