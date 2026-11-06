import { describe, expect, it } from "vitest";
import { addDays, todayIn, utcToZonedTime, zonedTimeToUtc } from "@/lib/dates";

describe("todayIn", () => {
  it("uses the workspace's timezone, not the server's", () => {
    // 23:30 UTC on 6 Nov is already 7 Nov in Lagos (UTC+1) and still 6 Nov in New York.
    const now = new Date("2026-11-06T23:30:00Z");
    expect(todayIn("Africa/Lagos", now)).toBe("2026-11-07");
    expect(todayIn("America/New_York", now)).toBe("2026-11-06");
    expect(todayIn("UTC", now)).toBe("2026-11-06");
  });

  it("adds days across month and year ends", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("zonedTimeToUtc", () => {
  it.each([
    ["2026-11-06T15:30", "Africa/Lagos", "2026-11-06T14:30:00.000Z"],
    ["2026-11-06T15:30", "UTC", "2026-11-06T15:30:00.000Z"],
    ["2026-11-06T09:00", "Asia/Kolkata", "2026-11-06T03:30:00.000Z"],
    // London is on GMT in January and BST (UTC+1) in July.
    ["2026-01-15T12:00", "Europe/London", "2026-01-15T12:00:00.000Z"],
    ["2026-07-15T12:00", "Europe/London", "2026-07-15T11:00:00.000Z"],
    ["2026-07-15T12:00", "America/New_York", "2026-07-15T16:00:00.000Z"],
  ])("%s in %s is %s", (local, timezone, utc) => {
    expect(zonedTimeToUtc(local, timezone).toISOString()).toBe(utc);
  });

  it("round-trips through utcToZonedTime", () => {
    for (const timezone of ["Africa/Lagos", "Europe/London", "America/New_York", "Asia/Tokyo"]) {
      expect(utcToZonedTime(zonedTimeToUtc("2026-03-29T10:15", timezone), timezone)).toBe("2026-03-29T10:15");
    }
  });
});
