import { describe, expect, it } from "vitest";
import { InvalidEnvironmentError, parseEnv } from "./env";

describe("parseEnv", () => {
  it("applies defaults when optional variables are absent", () => {
    expect(parseEnv({})).toEqual({ NODE_ENV: "development" });
  });

  it("accepts a valid configuration", () => {
    expect(parseEnv({ NODE_ENV: "production", APP_URL: "https://momentumdesk.app" })).toEqual({
      NODE_ENV: "production",
      APP_URL: "https://momentumdesk.app",
    });
  });

  it("treats empty strings as unset", () => {
    expect(parseEnv({ APP_URL: "" })).toEqual({ NODE_ENV: "development" });
  });

  it("reports every invalid variable by name", () => {
    try {
      parseEnv({ NODE_ENV: "staging", APP_URL: "not a url" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidEnvironmentError);
      const { issues } = error as InvalidEnvironmentError;
      expect(issues).toHaveLength(2);
      expect(issues.some((issue) => issue.startsWith("NODE_ENV:"))).toBe(true);
      expect(issues.some((issue) => issue.startsWith("APP_URL:"))).toBe(true);
    }
  });
});
