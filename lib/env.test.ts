import { describe, expect, it } from "vitest";
import { InvalidEnvironmentError, parseEnv } from "./env";

const DATABASE_URL = "postgresql://user:pass@localhost:5432/momentum";

describe("parseEnv", () => {
  it("applies defaults when optional variables are absent", () => {
    expect(parseEnv({ DATABASE_URL })).toEqual({ NODE_ENV: "development", DATABASE_URL });
  });

  it("accepts a valid configuration", () => {
    expect(
      parseEnv({ NODE_ENV: "production", APP_URL: "https://momentumdesk.app", DATABASE_URL }),
    ).toEqual({
      NODE_ENV: "production",
      APP_URL: "https://momentumdesk.app",
      DATABASE_URL,
    });
  });

  it("treats empty strings as unset", () => {
    expect(parseEnv({ APP_URL: "", DATABASE_URL })).toEqual({ NODE_ENV: "development", DATABASE_URL });
  });

  it("accepts both postgres URL schemes", () => {
    const url = "postgres://user@db.example.neon.tech/momentum?sslmode=require";
    expect(parseEnv({ DATABASE_URL: url }).DATABASE_URL).toBe(url);
  });

  it("requires DATABASE_URL", () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({ DATABASE_URL: "" })).toThrow(/DATABASE_URL/);
  });

  it("rejects a non-postgres DATABASE_URL", () => {
    expect(() => parseEnv({ DATABASE_URL: "mysql://user@localhost/momentum" })).toThrow(
      /DATABASE_URL: must be a postgres/,
    );
  });

  it("reports every invalid variable by name", () => {
    try {
      parseEnv({ NODE_ENV: "staging", APP_URL: "not a url", DATABASE_URL });
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
