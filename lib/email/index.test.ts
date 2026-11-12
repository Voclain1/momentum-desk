import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { consoleEmailSender, defaultEmailSender, emailIsDelivered, unconfiguredEmailSender } from "./index";

describe("defaultEmailSender", () => {
  it("writes to the end-to-end outbox only for a localhost app", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "outbox-")), "emails.jsonl");
    const local = { NODE_ENV: "production", APP_URL: "http://localhost:3100", EMAIL_TEST_OUTBOX: path };
    expect(emailIsDelivered(local)).toBe(true);
    await defaultEmailSender(local).send({ to: "a@example.com", subject: "Code", text: "123456" });
    expect(JSON.parse((await readFile(path, "utf8")).trim())).toMatchObject({ to: "a@example.com", subject: "Code", text: "123456" });

    // Never for a real deployment, even if the variable is set.
    const remote = { NODE_ENV: "production", APP_URL: "https://momentumdesk.app", EMAIL_TEST_OUTBOX: path };
    expect(defaultEmailSender(remote)).toBe(unconfiguredEmailSender);
    expect(emailIsDelivered(remote)).toBe(false);
    expect(defaultEmailSender({ NODE_ENV: "development" })).toBe(consoleEmailSender);
  });
});
