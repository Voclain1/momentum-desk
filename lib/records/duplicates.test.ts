import { describe, expect, it } from "vitest";
import { phoneKey } from "./duplicates";

describe("phoneKey", () => {
  it("matches local and international forms of the same number", () => {
    expect(phoneKey("0801 234 5678")).toBe(phoneKey("+234 801 234 5678"));
    expect(phoneKey("(0801) 234-5678")).toBe("012345678");
    expect(phoneKey("+44 20 7946 0958")).toBe(phoneKey("020 7946 0958"));
  });

  it("does not match different numbers or treat short ones as keys", () => {
    expect(phoneKey("0801 234 5678")).not.toBe(phoneKey("0801 234 5679"));
    expect(phoneKey("12345")).toBeNull();
    expect(phoneKey("")).toBeNull();
    expect(phoneKey(null)).toBeNull();
  });
});
