import { describe, expect, it } from "vitest";
import { scrubEvent, scrubText } from "./scrub";

describe("scrubText", () => {
  it.each([
    ["https://momentumdesk.app/reset-password?token=abc123", "https://momentumdesk.app/reset-password?token=[redacted]"],
    ["/api/auth/magic-link/verify?token=xyz&callbackURL=/app", "/api/auth/magic-link/verify?token=[redacted]&callbackURL=[redacted]"],
    ["/invite/inv_9f8e7d", "/invite/[redacted]"],
    ["/api/auth/reset-password/tok_123?callbackURL=%2Freset", "/api/auth/reset-password/[redacted]?callbackURL=[redacted]"],
    ["User ada.obi@example.com not found", "User [email] not found"],
    ["Rate limited 203.0.113.7 on /sign-in", "Rate limited [ip] on /sign-in"],
    ["fetch('/invite/inv_123')", "fetch('/invite/[redacted]')"],
    ["/app/settings?tab=team", "/app/settings?tab=team"],
    ["version 16.3.8 build 1.2", "version 16.3.8 build 1.2"],
  ])("scrubs %s", (input, output) => {
    expect(scrubText(input)).toBe(output);
  });
});

describe("scrubEvent", () => {
  it("removes cookies, auth and IP headers, bodies, query strings and personal user fields", () => {
    const event = scrubEvent({
      message: "Failed for ada@example.com",
      request: {
        url: "https://momentumdesk.app/invite/inv_123",
        query_string: "token=abc",
        cookies: { "better-auth.session_token": "secret" },
        data: { password: "hunter2" },
        headers: {
          Authorization: "Bearer secret",
          Cookie: "a=b",
          "X-Forwarded-For": "203.0.113.7",
          "User-Agent": "Mozilla/5.0",
        },
      },
      user: { id: "user_1", email: "ada@example.com", ip_address: "203.0.113.7", username: "ada" },
      exception: { values: [{ value: "Invalid token for bob@example.com" }] },
      breadcrumbs: [{ message: "navigate", data: { from: "/invite/inv_1", to: "/reset-password?token=t" } }],
    });

    expect(event).toEqual({
      message: "Failed for [email]",
      request: { url: "https://momentumdesk.app/invite/[redacted]", headers: { "User-Agent": "Mozilla/5.0" } },
      user: { id: "user_1" },
      exception: { values: [{ value: "Invalid token for [email]" }] },
      breadcrumbs: [{ message: "navigate", data: { from: "/invite/[redacted]", to: "/reset-password?token=[redacted]" } }],
    });
  });

  it("drops local variable values from stack frames and scrubs the code shown around them", () => {
    const event = scrubEvent({
      exception: {
        values: [
          {
            value: "boom",
            stacktrace: {
              frames: [
                {
                  vars: { password: "hunter2", email: "ada@example.com" },
                  pre_context: ["const to = 'ada@example.com';"],
                  context_line: "fetch('/invite/inv_123')",
                  post_context: ["// done"],
                },
              ],
            },
          },
        ],
      },
    });
    expect(event.exception?.values?.[0].stacktrace?.frames?.[0]).toEqual({
      pre_context: ["const to = '[email]';"],
      context_line: "fetch('/invite/[redacted]')",
      post_context: ["// done"],
    });
  });

  it("drops a user with no id entirely", () => {
    expect(scrubEvent({ user: { ip_address: "203.0.113.7" } }).user).toEqual({});
  });
});
