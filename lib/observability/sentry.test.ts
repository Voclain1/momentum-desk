import * as Sentry from "@sentry/nextjs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initSentry } from "./sentry";
import { sentryOptions } from "./sentry-options";

/**
 * Runs the real Sentry SDK with our options and a transport that records
 * everything it would send, to prove scrubbing is applied end to end.
 * Tracing is forced to 100% so spans are always produced and checked too.
 */
const sent: string[] = [];
const SECRETS = ["ada@example.com", "s3cret", "203.0.113.7", '"vars"'];

beforeAll(() => {
  vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://publickey@o1.ingest.sentry.io/1");
  initSentry({
    tracesSampleRate: 1,
    transport: () => ({
      send: async (envelope: unknown) => {
        sent.push(JSON.stringify(envelope));
        return {};
      },
      flush: async () => true,
    }),
  });
});

beforeEach(() => {
  sent.length = 0;
});

afterAll(async () => {
  await Sentry.close();
  vi.unstubAllEnvs();
});

function expectNoSecrets() {
  for (const envelope of sent) {
    for (const secret of SECRETS) expect(envelope).not.toContain(secret);
  }
}

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

    const events = sent.filter((envelope) => envelope.includes('{"type":"event"}'));
    expect(events).toHaveLength(1);
    expect(events[0]).toContain("Reset failed for [email] at /reset-password?token=[redacted]");
    expect(events[0]).toContain('"organization_id":"org_1"');
    expect(events[0]).toContain('"id":"user_1"');
    expectNoSecrets();
  });

  it("sends performance spans with secrets and personal data removed", async () => {
    Sentry.startSpan(
      {
        name: "GET /reset-password?token=s3cret",
        attributes: {
          "url.full": "https://momentumdesk.app/invite/inv_1?token=s3cret",
          "user.email": "ada@example.com",
          "client.address": "203.0.113.7",
        },
      },
      () => undefined,
    );
    await Sentry.flush(2000);

    expect(sent.length).toBeGreaterThan(0);
    expect(sent.join("\n")).toContain("GET /reset-password?token=[redacted]");
    expectNoSecrets();
  });
});
