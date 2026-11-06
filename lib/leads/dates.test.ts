import { describe, expect, it } from "vitest";
import { addDays, todayIn } from "./dates";

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
