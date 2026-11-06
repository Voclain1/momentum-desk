import { describe, expect, it } from "vitest";
import { InvalidEnvironmentError, parseEnv } from "./env";

const DATABASE_URL = "postgresql://user:pass@localhost:5432/momentum";
const BETTER_AUTH_SECRET = "a".repeat(32);
const required = { DATABASE_URL, BETTER_AUTH_SECRET };

describe("parseEnv", () => {
  it("applies defaults when optional variables are absent", () => {
    expect(parseEnv(required)).toEqual({ NODE_ENV: "development", ...required });
  });

  it("accepts a valid configuration", () => {
    expect(
      parseEnv({ NODE_ENV: "production", APP_URL: "https://momentumdesk.app", ...required }),
    ).toEqual({
      NODE_ENV: "production",
      APP_URL: "https://momentumdesk.app",
      ...required,
    });
  });

  it("treats empty strings as unset", () => {
    expect(parseEnv({ APP_URL: "", ...required })).toEqual({ NODE_ENV: "development", ...required });
  });

  it("accepts both postgres URL schemes", () => {
    const url = "postgres://user@db.example.neon.tech/momentum?sslmode=require";
    expect(parseEnv({ ...required, DATABASE_URL: url }).DATABASE_URL).toBe(url);
  });

  it("requires DATABASE_URL", () => {
    expect(() => parseEnv({ BETTER_AUTH_SECRET })).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({ BETTER_AUTH_SECRET, DATABASE_URL: "" })).toThrow(/DATABASE_URL/);
  });

  it("rejects a non-postgres DATABASE_URL", () => {
    expect(() => parseEnv({ ...required, DATABASE_URL: "mysql://user@localhost/momentum" })).toThrow(
      /DATABASE_URL: must be a postgres/,
    );
  });

  it("requires a BETTER_AUTH_SECRET of at least 32 characters", () => {
    expect(() => parseEnv({ DATABASE_URL })).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => parseEnv({ DATABASE_URL, BETTER_AUTH_SECRET: "too-short" })).toThrow(
      /BETTER_AUTH_SECRET: must be at least 32 characters/,
    );
  });

  it("accepts Resend settings together", () => {
    const env = parseEnv({ ...required, RESEND_API_KEY: "re_123", EMAIL_FROM: "MomentumDesk <no-reply@momentumdesk.app>" });
    expect(env).toMatchObject({ RESEND_API_KEY: "re_123", EMAIL_FROM: "MomentumDesk <no-reply@momentumdesk.app>" });
    expect(parseEnv({ ...required, RESEND_API_KEY: "re_123", EMAIL_FROM: "no-reply@momentumdesk.app" }).EMAIL_FROM).toBe(
      "no-reply@momentumdesk.app",
    );
  });

  it("requires RESEND_API_KEY and EMAIL_FROM together", () => {
    expect(() => parseEnv({ ...required, RESEND_API_KEY: "re_123" })).toThrow(/EMAIL_FROM: RESEND_API_KEY and EMAIL_FROM/);
    expect(() => parseEnv({ ...required, EMAIL_FROM: "no-reply@momentumdesk.app" })).toThrow(/set together/);
  });

  it("rejects a malformed Resend key or sender", () => {
    expect(() => parseEnv({ ...required, RESEND_API_KEY: "sk_123", EMAIL_FROM: "a@b.co" })).toThrow(/RESEND_API_KEY/);
    expect(() => parseEnv({ ...required, RESEND_API_KEY: "re_123", EMAIL_FROM: "MomentumDesk" })).toThrow(/EMAIL_FROM/);
  });

  it("reports every invalid variable by name", () => {
    try {
      parseEnv({ NODE_ENV: "staging", APP_URL: "not a url", ...required });
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
