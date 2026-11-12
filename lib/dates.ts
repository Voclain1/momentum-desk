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

/** Milliseconds a timezone is ahead of UTC at a given instant. */
function offsetMs(instant: Date, timezone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant a wall-clock time ("YYYY-MM-DDTHH:mm") happens in a timezone,
 * e.g. 15:30 in Lagos is 14:30 UTC. Handles daylight saving changes.
 */
export function zonedTimeToUtc(local: string, timezone: string): Date {
  const naive = new Date(`${local}:00Z`);
  const first = new Date(naive.getTime() - offsetMs(naive, timezone));
  const second = offsetMs(first, timezone);
  return second === offsetMs(naive, timezone) ? first : new Date(naive.getTime() - second);
}

/** "YYYY-MM-DDTHH:mm" for an instant in a timezone, for datetime-local inputs. */
export function utcToZonedTime(instant: Date, timezone: string): string {
  const shifted = new Date(instant.getTime() + offsetMs(instant, timezone));
  return shifted.toISOString().slice(0, 16);
}
