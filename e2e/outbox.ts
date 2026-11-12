import { readFile } from "node:fs/promises";
import { expect } from "@playwright/test";
import { EMAIL_OUTBOX } from "../playwright.config";

export interface OutboxEmail {
  to: string;
  subject: string;
  text: string;
}

/** The latest email to an address, waiting briefly for it to be written. */
export async function lastEmailTo(to: string, matching: RegExp = /./): Promise<OutboxEmail> {
  let found: OutboxEmail | undefined;
  await expect
    .poll(async () => {
      const lines = (await readFile(EMAIL_OUTBOX, "utf8").catch(() => "")).split("\n").filter(Boolean);
      found = lines
        .map((line) => JSON.parse(line) as OutboxEmail)
        .findLast((email) => email.to === to && matching.test(email.subject + "\n" + email.text));
      return Boolean(found);
    })
    .toBe(true);
  return found!;
}
