import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./redirect";

describe("safeRedirectPath", () => {
  it.each(["/app", "/app/customers?page=2", "/onboarding#step-2"])("keeps %s", (path) => {
    expect(safeRedirectPath(path)).toBe(path);
  });

  it.each([
    null,
    undefined,
    "",
    "app",
    "https://evil.example/app",
    "//evil.example/app",
    "/\\evil.example",
    "\\\\evil.example",
    "/\t/evil.example",
    "javascript:alert(1)",
  ])("falls back for %j", (next) => {
    expect(safeRedirectPath(next)).toBe("/app");
  });

  it("uses the given fallback", () => {
    expect(safeRedirectPath("https://evil.example", "/onboarding")).toBe("/onboarding");
  });
});
