import * as Sentry from "@sentry/nextjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sentryOptions } from "./sentry-options";

/**
 * Runs the real Sentry SDK with our options and a transport that records
 * what would be sent, to prove the scrubber is applied end to end.
 */
const sent: string[] = [];

beforeAll(() => {
  vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://publickey@o1.ingest.sentry.io/1");
  Sentry.init({
    ...sentryOptions(),
    transport: () => ({
      send: async (envelope: unknown) => {
        sent.push(JSON.stringify(envelope));
        return {};
      },
      flush: async () => true,
    }),
  });
});

afterAll(async () => {
  await Sentry.close();
  vi.unstubAllEnvs();
});

describe("Sentry with MomentumDesk options", () => {
  it("is off without a DSN", () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
    expect(sentryOptions()).toMatchObject({ enabled: false, dsn: undefined });
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://publickey@o1.ingest.sentry.io/1");
  });

  it("sends errors with secrets and personal data removed", async () => {
    Sentry.setUser({ id: "user_1", email: "ada@example.com", ip_address: "203.0.113.7" });
    Sentry.setTag("organization_id", "org_1");
    Sentry.captureException(new Error("Reset failed for ada@example.com at /reset-password?token=s3cret"));
    await Sentry.flush(2000);

    expect(sent).toHaveLength(1);
    const [envelope] = sent;
    expect(envelope).toContain("Reset failed for [email] at /reset-password?token=[redacted]");
    expect(envelope).toContain('"organization_id":"org_1"');
    expect(envelope).toContain('"id":"user_1"');
    expect(envelope).not.toContain("ada@example.com");
    expect(envelope).not.toContain("s3cret");
    expect(envelope).not.toContain("203.0.113.7");
    expect(envelope).not.toContain('"vars"');
  });
});
