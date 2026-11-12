import { z } from "zod";
import { calendarDate, optional, text } from "@/lib/validation/fields";

export { fieldErrors } from "@/lib/validation/fields";

export const taskInputSchema = z.strictObject({
  title: z.string().trim().min(1, { error: "is required" }).max(200),
  notes: text(2000),
  /** Calendar date in the workspace's timezone. */
  dueOn: calendarDate,
  assigneeUserId: optional(z.string().trim().min(1).max(64)),
});

export type TaskInput = z.output<typeof taskInputSchema>;
