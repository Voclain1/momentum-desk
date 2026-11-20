import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { renderInvoicePdf } from "@/lib/documents/invoice-pdf";
import { createTenantData } from "@/lib/tenant/core";
import { createTestDb, disconnectOwnerDb, resetDatabase } from "@/test/db";
import { documentBrand, getBranding, pdfSeller, removeLogo, setAccentColor, setLogo } from "./service";

const db = createTestDb();
const data = createTenantData(db);
const fixture = (name: string) => new Uint8Array(readFileSync(`test/fixtures/${name}`));

beforeEach(() => resetDatabase());
afterAll(() => Promise.all([db.$disconnect(), disconnectOwnerDb()]));

async function workspace() {
  const organizationId = randomUUID();
  await db.organization.create({
    data: { id: organizationId, name: "Sun Power", slug: `sun-${organizationId.slice(0, 8)}`, baseCurrency: "NGN", countryCode: "NG", locale: "en-NG", timezone: "Africa/Lagos", defaultLanguage: "en" },
  });
  const userId = randomUUID();
  await db.user.create({ data: { id: userId, name: "Ada", email: `${userId}@example.com` } });
  await db.member.create({ data: { id: randomUUID(), organizationId, userId, role: "owner" } });
  return { organizationId, userId };
}

const fields = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return (error as { fields?: Record<string, string> }).fields;
  }
  throw new Error("expected a validation error");
};

describe("branding", () => {
  it("keeps a checked logo and colour, audited, and gives the logo a URL that changes with it", async () => {
    const actor = await workspace();
    expect(await documentBrand(data, actor.organizationId)).toEqual({ logoUrl: null, accentColor: null });
    const hash = await setLogo(data, actor, fixture("logo.png"));
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    await setAccentColor(data, actor, "#1F3A5F");
    expect(await documentBrand(data, actor.organizationId)).toEqual({ logoUrl: `/logo/${actor.organizationId}/${hash}`, accentColor: "#1f3a5f" });
    const jpeg = await setLogo(data, actor, fixture("logo.jpg"));
    expect(jpeg).not.toBe(hash);
    expect((await getBranding(data, actor.organizationId)).logo?.type).toBe("image/jpeg");

    // The logo goes into PDFs: a branded PDF is larger than a plain one.
    const invoice = {
      number: "INV-0001", status: "issued", issuedOn: new Date("2026-11-01"), dueOn: new Date("2026-11-15"), paidMinor: 0n,
      paymentInstructions: null, voidedAt: null, currency: "NGN", taxMode: "exclusive", recipientName: null, recipientEmail: null,
      customerSnapshot: { displayName: "Okafor Farms" }, notes: null, terms: null, subtotalMinor: 100n, discountMinor: 0n,
      taxMinor: 0n, totalMinor: 100n, taxLines: [], items: [],
    } as unknown as Parameters<typeof renderInvoicePdf>[0];
    const plain = await renderInvoicePdf(invoice, { seller: "Sun Power", locale: "en-NG" });
    const branded = await renderInvoicePdf(invoice, await pdfSeller(data, actor.organizationId, { name: "Sun Power", locale: "en-NG" }));
    expect(branded.length).toBeGreaterThan(plain.length + 500);

    await removeLogo(data, actor);
    expect((await getBranding(data, actor.organizationId)).logo).toBeNull();
    const audit = await data.scoped(actor.organizationId).auditLog.findMany({ where: { action: "branding.updated" }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => (a.metadata as { change: string }).change)).toEqual(["logo", "accent_color", "logo", "logo_removed"]);
  });

  it("refuses what is not a usable logo or a readable colour", async () => {
    const actor = await workspace();
    expect(await fields(setLogo(data, actor, new TextEncoder().encode("<svg onload=alert(1)>")))).toEqual({ logo: "must be a PNG or JPEG image" });
    expect(await fields(setLogo(data, actor, fixture("logo-tiny.png")))).toEqual({ logo: "must be between 16 and 4000 pixels on each side" });
    expect(await fields(setLogo(data, actor, new Uint8Array(300 * 1024)))).toEqual({ logo: "must be at most 256 KB" });
    expect(await fields(setAccentColor(data, actor, "#ffd400"))).toEqual({ accentColor: "is too light to read on white; choose a darker colour" });
    expect(await fields(setAccentColor(data, actor, "red"))).toEqual({ accentColor: "must be a colour like #1f6feb" });
    // Each workspace sees only its own branding.
    const other = await workspace();
    await setLogo(data, other, fixture("logo.png"));
    expect((await getBranding(data, actor.organizationId)).logo).toBeNull();
  });
});
