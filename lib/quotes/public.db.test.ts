import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createCustomer } from "@/lib/customers/service";
import { createMemoryEmailSender, type EmailSender, unconfiguredEmailSender } from "@/lib/email";
import { RecordConflictError } from "@/lib/errors";
import { createTenantData } from "@/lib/tenant/core";
import { createPublicLinks } from "@/lib/tenant/public";
import { createTestDb, disconnectOwnerDb, resetDatabase } from "@/test/db";
import { confirmAcceptance, contentHash, openQuote, rejectQuote, requestAcceptanceCode } from "./public";
import { createQuote, getQuote, reviseQuote, sendQuote } from "./service";
import { createShareLink, emailQuote, quoteActivity, revokeShareLinks } from "./sharing";

/** As the restricted app role, like the application. */
const db = createTestDb();
const data = createTenantData(db);
const links = createPublicLinks(db);
const visitor = { ipAddress: "203.0.113.7", userAgent: "Test browser" };

let clock = new Date("2026-11-12T10:00:00Z");
const later = (minutes: number) => (clock = new Date(clock.getTime() + minutes * 60_000));

beforeEach(async () => {
  clock = new Date("2026-11-12T10:00:00Z");
  await resetDatabase();
});
afterAll(() => Promise.all([db.$disconnect(), disconnectOwnerDb()]));

async function sentQuote({ email = "chidi@okafor.ng" as string | null, expiresOn = "2026-12-12" } = {}) {
  const organizationId = randomUUID();
  await db.organization.create({
    data: {
      id: organizationId, name: "Bright Solar", slug: `bright-${organizationId.slice(0, 8)}`,
      baseCurrency: "NGN", countryCode: "NG", locale: "en-NG", timezone: "Africa/Lagos", defaultLanguage: "en",
    },
  });
  const userId = randomUUID();
  await db.user.create({ data: { id: userId, name: "Ada", email: `${userId}@example.com` } });
  await db.member.create({ data: { id: randomUUID(), organizationId, userId, role: "owner" } });
  const actor = { organizationId, userId };
  const customer = await createCustomer(data, actor, { type: "organization", displayName: "Okafor Farms", email });
  const quote = await createQuote(data, actor, {
    customerId: customer.id, currency: "NGN", taxMode: "exclusive", issuedOn: "2026-11-12", expiresOn,
    lines: [{ description: "Solar panel", quantity: "2", unitPrice: "185000" }],
  });
  await sendQuote(data, actor, quote.id, 1, { today: "2026-11-12" });
  const { token } = await createShareLink(data, actor, quote.id);
  return { actor, quote, token };
}

function deps(email: EmailSender = createMemoryEmailSender()) {
  return { data, links, email, now: () => clock };
}

const codeIn = (text: string) => /code to accept quote .* is: (\d{6})/.exec(text)?.[1] ?? "";

describe("share links", () => {
  it("opens the quote for the token only, records the first view once per half hour, and stops when revoked", async () => {
    const { actor, quote, token } = await sentQuote();
    expect(await openQuote(deps(), "not-a-token", visitor)).toEqual({ state: "invalid" });
    expect(await openQuote(deps(), "A".repeat(43), visitor)).toEqual({ state: "invalid" });

    const view = await openQuote(deps(), token, visitor);
    expect(view).toMatchObject({ state: "ready", open: true, expired: false, seller: { name: "Bright Solar", locale: "en-NG" } });
    expect((await getQuote(data, actor.organizationId, quote.id)).viewedAt).toEqual(clock);
    await openQuote(deps(), token, visitor);
    later(31);
    await openQuote(deps(), token, visitor);
    const { events, links: shared } = await quoteActivity(data, actor.organizationId, quote.id);
    expect(events.map((e) => [e.kind, e.ipAddress, e.userAgent])).toEqual([
      ["viewed", "203.0.113.7", "Test browser"],
      ["viewed", "203.0.113.7", "Test browser"],
    ]);
    // The first view time does not move.
    expect((await getQuote(data, actor.organizationId, quote.id)).viewedAt).toEqual(new Date("2026-11-12T10:00:00Z"));
    expect(shared).toHaveLength(1);

    await revokeShareLinks(data, actor, quote.id);
    expect(await openQuote(deps(), token, visitor)).toEqual({ state: "invalid" });
  });

  it("keeps tokens unreadable without the token, and refuses links to drafts", async () => {
    const { actor } = await sentQuote();
    // No organization and no token set: the app role sees no link rows at all.
    expect(await db.quoteLink.findMany()).toEqual([]);
    const draft = await createQuote(data, actor, {
      customerId: (await getQuote(data, actor.organizationId, (await data.scoped(actor.organizationId).quote.findFirstOrThrow()).id)).customerId,
      currency: "NGN", taxMode: "exclusive", issuedOn: "2026-11-12", expiresOn: "2026-12-12",
      lines: [{ description: "X", quantity: "1", unitPrice: "1" }],
    });
    await expect(createShareLink(data, actor, draft.id)).rejects.toThrow(RecordConflictError);
  });

  it("says a superseded link was replaced, and shows nothing else", async () => {
    const { actor, quote, token } = await sentQuote();
    const revision = await reviseQuote(data, actor, quote.id, { today: "2026-11-12" });
    await sendQuote(data, actor, revision.id, 1, { today: "2026-11-12" });
    expect(await openQuote(deps(), token, visitor)).toEqual({ state: "superseded", seller: "Bright Solar" });
    expect(await requestAcceptanceCode(deps(), token, { name: "Chidi" }, visitor)).toMatchObject({
      ok: false, message: "This quote was replaced by a newer version. Ask for the latest link.",
    });
  });

  it("emails a fresh link to the recipient, and keeps nothing when the email fails", async () => {
    const { actor, quote } = await sentQuote();
    const email = createMemoryEmailSender();
    expect(await emailQuote(data, actor, quote.id, { appUrl: "https://momentumdesk.app", seller: "Bright Solar", email })).toEqual({
      sentTo: "chidi@okafor.ng",
    });
    const message = email.lastTo("chidi@okafor.ng")!;
    expect(message.subject).toBe("Quote Q-0001 from Bright Solar");
    const token = /https:\/\/momentumdesk\.app\/q\/([A-Za-z0-9_-]{43})/.exec(message.text)![1];
    expect(await openQuote(deps(), token, visitor)).toMatchObject({ state: "ready" });

    await expect(emailQuote(data, actor, quote.id, { appUrl: "https://x.test", seller: "B", email: unconfiguredEmailSender })).rejects.toThrow(
      /Email is not configured/,
    );
    expect((await quoteActivity(data, actor.organizationId, quote.id)).links).toHaveLength(2);
  });
});

describe("acceptance", () => {
  it("accepts with a code sent to the recipient, recording evidence of the exact version", async () => {
    const { actor, quote, token } = await sentQuote();
    const email = createMemoryEmailSender();
    expect(await requestAcceptanceCode(deps(email), token, { name: "Chidi Okafor", email: "attacker@evil.test" }, visitor)).toEqual({
      ok: true, message: "We sent a 6-digit code to c••••@okafor.ng.",
    });
    // The code goes to the quote's recipient, never an address the visitor types.
    expect(email.sent.map((m) => m.to)).toEqual(["chidi@okafor.ng"]);
    const code = codeIn(email.sent[0].text);
    expect(await openQuote(deps(email), token, visitor)).toMatchObject({ pendingCode: { sentTo: "c••••@okafor.ng" } });

    const wrong = code === "000000" ? "111111" : "000000";
    expect(await confirmAcceptance(deps(email), token, { code: wrong }, visitor)).toEqual({ ok: false, message: "That code is not right. 4 tries left." });
    expect(await confirmAcceptance(deps(email), token, { code }, visitor)).toEqual({
      ok: true, message: "Thank you, Chidi Okafor. You accepted quote Q-0001.",
    });

    const accepted = await getQuote(data, actor.organizationId, quote.id);
    expect(accepted).toMatchObject({ status: "accepted", acceptedAt: clock });
    const { events } = await quoteActivity(data, actor.organizationId, quote.id);
    const evidence = events.find((e) => e.kind === "accepted")!;
    expect(evidence).toMatchObject({ name: "Chidi Okafor", email: "chidi@okafor.ng", ipAddress: "203.0.113.7", userAgent: "Test browser" });
    expect(evidence.contentHash).toBe(contentHash(accepted));
    expect(await openQuote(deps(email), token, visitor)).toMatchObject({ open: false, acceptance: { name: "Chidi Okafor" } });

    // Answered once: no second acceptance, no rejection, no evidence edits.
    expect(await confirmAcceptance(deps(email), token, { code }, visitor)).toMatchObject({ ok: false, message: "This quote has already been answered." });
    expect(await rejectQuote(deps(email), token, {}, visitor)).toMatchObject({ ok: false });
    await expect(data.scoped(actor.organizationId).quoteEvent.updateMany({ where: {}, data: { name: "Someone else" } })).rejects.toThrow(/append-only/);
    const audit = await data.scoped(actor.organizationId).auditLog.findFirst({ where: { action: "quote.accepted" } });
    expect(audit).toMatchObject({ actorUserId: null, metadata: { number: "Q-0001", revision: 1, via: "public_link" } });
  });

  it("asks for an email when the quote has no recipient address", async () => {
    const { token } = await sentQuote({ email: null });
    const email = createMemoryEmailSender();
    expect(await requestAcceptanceCode(deps(email), token, { name: "Chidi" }, visitor)).toMatchObject({
      ok: false, fields: { email: "must be a valid email address" },
    });
    expect(await requestAcceptanceCode(deps(email), token, { name: "Chidi", email: "Chidi@Okafor.ng" }, visitor)).toMatchObject({ ok: true });
    expect(email.sent.map((m) => m.to)).toEqual(["chidi@okafor.ng"]);
  });

  it("limits codes: 10 minutes, 5 attempts, 5 per hour, and none kept if the email fails", async () => {
    const { token } = await sentQuote();
    const email = createMemoryEmailSender();
    await requestAcceptanceCode(deps(email), token, { name: "C" }, visitor);
    later(11);
    expect(await confirmAcceptance(deps(email), token, { code: codeIn(email.sent[0].text) }, visitor)).toEqual({
      ok: false, message: "That code has expired or was used up. Request a new one.",
    });

    await requestAcceptanceCode(deps(email), token, { name: "C" }, visitor);
    const code = codeIn(email.sent[1].text);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) await confirmAcceptance(deps(email), token, { code: wrong }, visitor);
    expect(await confirmAcceptance(deps(email), token, { code }, visitor)).toMatchObject({ ok: false, message: /expired or was used up/ });

    for (let i = 0; i < 3; i++) expect(await requestAcceptanceCode(deps(email), token, { name: "C" }, visitor)).toMatchObject({ ok: true });
    expect(await requestAcceptanceCode(deps(email), token, { name: "C" }, visitor)).toEqual({
      ok: false, message: "Too many codes were requested for this quote. Try again in an hour.",
    });

    const fresh = await sentQuote();
    await expect(requestAcceptanceCode(deps(unconfiguredEmailSender), fresh.token, { name: "C" }, visitor)).rejects.toThrow(/not configured/);
    const { events } = await quoteActivity(data, fresh.actor.organizationId, fresh.quote.id);
    expect(events.filter((e) => e.kind === "code_sent")).toEqual([]);
  });

  it("closes acceptance once the quote expires, but still shows it", async () => {
    const { token } = await sentQuote({ expiresOn: "2026-11-20" });
    clock = new Date("2026-11-21T08:00:00Z");
    expect(await openQuote(deps(), token, visitor)).toMatchObject({ state: "ready", open: false, expired: true });
    expect(await requestAcceptanceCode(deps(), token, { name: "C" }, visitor)).toEqual({
      ok: false, message: "This quote has expired, so it can no longer be accepted.",
    });
  });
});

describe("rejection", () => {
  it("records who declined and why, without a code", async () => {
    const { actor, quote, token } = await sentQuote();
    expect(await rejectQuote(deps(), token, { name: "Chidi", reason: "Too expensive for now" }, visitor)).toEqual({
      ok: true, message: "You declined quote Q-0001. Your answer has been recorded for Bright Solar.",
    });
    expect(await getQuote(data, actor.organizationId, quote.id)).toMatchObject({ status: "rejected", rejectedAt: clock });
    const { events } = await quoteActivity(data, actor.organizationId, quote.id);
    expect(events.find((e) => e.kind === "rejected")).toMatchObject({ name: "Chidi", reason: "Too expensive for now" });
    expect(await requestAcceptanceCode(deps(), token, { name: "Chidi" }, visitor)).toMatchObject({ ok: false, message: "This quote has already been answered." });
    // A rejected quote can still be revised into a new offer; once that is
    // sent, the old link says it was replaced (D16).
    const revision = await reviseQuote(data, actor, quote.id, { today: "2026-11-12" });
    expect(await openQuote(deps(), token, visitor)).toMatchObject({ state: "ready" });
    await sendQuote(data, actor, revision.id, 1, { today: "2026-11-12" });
    expect(await openQuote(deps(), token, visitor)).toEqual({ state: "superseded", seller: "Bright Solar" });
  });
});
