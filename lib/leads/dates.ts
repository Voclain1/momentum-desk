/** Today's date ("YYYY-MM-DD") in a timezone: follow-ups are calendar dates in the workspace's timezone. */
export function todayIn(timezone: string, now: Date = new Date()): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** A "YYYY-MM-DD" date as the UTC midnight the database stores for a DATE column. */
export const dateValue = (day: string) => new Date(`${day}T00:00:00Z`);

export function addDays(day: string, days: number): string {
  const date = dateValue(day);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
