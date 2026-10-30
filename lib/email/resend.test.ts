import { describe, expect, it, vi } from "vitest";
import { consoleEmailSender, defaultEmailSender, unconfiguredEmailSender } from "./index";
import { createResendEmailSender, EmailDeliveryError } from "./resend";

const API_KEY = "re_test_secret_key";
const FROM = "MomentumDesk <no-reply@momentumdesk.app>";
const message = { to: "ada@example.com", subject: "Hello", text: "Body" };

function fakeFetch(response: Response | Error) {
  return vi.fn<typeof fetch>(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
}

describe("createResendEmailSender", () => {
  it("posts the message to Resend with the API key", async () => {
    const fetch = fakeFetch(Response.json({ id: "email_1" }));
    await createResendEmailSender({ apiKey: API_KEY, from: FROM, fetch }).send(message);

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" });
    expect(init?.headers).not.toHaveProperty("Idempotency-Key");
    expect(JSON.parse(String(init?.body))).toEqual({ from: FROM, to: ["ada@example.com"], subject: "Hello", text: "Body" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("passes an idempotency key when given one", async () => {
    const fetch = fakeFetch(Response.json({ id: "email_1" }));
    await createResendEmailSender({ apiKey: API_KEY, from: FROM, fetch }).send({ ...message, idempotencyKey: "invite/123" });
    expect(fetch.mock.calls[0][1]?.headers).toMatchObject({ "Idempotency-Key": "invite/123" });
  });

  it("throws on a rejected request without leaking the key or recipient", async () => {
    const fetch = fakeFetch(
      Response.json({ name: "validation_error", message: "The ada@example.com domain is not verified" }, { status: 422 }),
    );
    const error = await createResendEmailSender({ apiKey: API_KEY, from: FROM, fetch })
      .send(message)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EmailDeliveryError);
    expect((error as EmailDeliveryError).status).toBe(422);
    expect((error as Error).message).toContain("validation_error");
    expect((error as Error).message).not.toContain(API_KEY);
    expect((error as Error).message).not.toContain("ada@example.com");
  });

  it("throws on network failures and timeouts", async () => {
    const timeout = Object.assign(new Error("aborted"), { name: "TimeoutError" });
    await expect(
      createResendEmailSender({ apiKey: API_KEY, from: FROM, fetch: fakeFetch(timeout) }).send(message),
    ).rejects.toThrow(/timed out/);
    await expect(
      createResendEmailSender({ apiKey: API_KEY, from: FROM, fetch: fakeFetch(new TypeError("fetch failed")) }).send(message),
    ).rejects.toThrow(/network error/);
  });

  it("copes with an error response that is not JSON", async () => {
    const fetch = fakeFetch(new Response("Bad gateway", { status: 502 }));
    await expect(createResendEmailSender({ apiKey: API_KEY, from: FROM, fetch }).send(message)).rejects.toThrow(
      /\(502\): unknown_error/,
    );
  });
});

describe("defaultEmailSender", () => {
  it("uses Resend whenever it is configured", () => {
    const sender = defaultEmailSender({ NODE_ENV: "production", RESEND_API_KEY: API_KEY, EMAIL_FROM: FROM });
    expect(sender).not.toBe(unconfiguredEmailSender);
    expect(sender).not.toBe(consoleEmailSender);
  });

  it("logs in development and refuses in production without Resend", () => {
    expect(defaultEmailSender({ NODE_ENV: "development" })).toBe(consoleEmailSender);
    expect(defaultEmailSender({ NODE_ENV: "production" })).toBe(unconfiguredEmailSender);
  });
});
