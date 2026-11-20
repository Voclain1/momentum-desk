import { createHash } from "node:crypto";
import { recordAudit } from "@/lib/audit";
import { InputValidationError } from "@/lib/errors";
import type { TenantData, TenantDb } from "@/lib/tenant/core";

/**
 * A workspace's logo and accent colour (spec §7.5 branded documents,
 * decision D39). The logo is checked by its content, never by its name or
 * declared type, and kept in the database. Changing branding needs
 * settings:write (the caller checks).
 */

export const MAX_LOGO_BYTES = 256 * 1024;
const MAX_SIDE = 4000;
const MIN_SIDE = 16;

export type LogoType = "image/png" | "image/jpeg";

export interface Branding {
  logo: { bytes: Uint8Array; type: LogoType; hash: string } | null;
  accentColor: string | null;
}

/** Width and height from a PNG's IHDR or a JPEG's start-of-frame; null if the bytes are neither. */
export function imageInfo(bytes: Uint8Array): { type: LogoType; width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 24 && png.every((b, i) => bytes[i] === b) && String.fromCharCode(...bytes.slice(12, 16)) === "IHDR") {
    return { type: "image/png", width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) return null;
      const marker = bytes[at + 1];
      const length = view.getUint16(at + 2);
      // Start-of-frame markers (baseline, progressive and others), not DHT/JPG/DAC.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { type: "image/jpeg", height: view.getUint16(at + 5), width: view.getUint16(at + 7) };
      }
      if (length < 2) return null;
      at += 2 + length;
    }
  }
  return null;
}

/** WCAG contrast ratio of a colour against white. */
export function contrastWithWhite(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
  return 1.05 / (luminance + 0.05);
}

export async function getBranding(data: TenantData, organizationId: string): Promise<Branding> {
  const row = await data.scoped(organizationId).organizationBranding.findFirst();
  return {
    logo: row?.logo && row.logoType && row.logoHash ? { bytes: new Uint8Array(row.logo), type: row.logoType as LogoType, hash: row.logoHash } : null,
    accentColor: row?.accentColor ?? null,
  };
}

/** The public path of a workspace's current logo; it changes whenever the logo does. */
export const logoPath = (organizationId: string, hash: string) => `/logo/${organizationId}/${hash}`;

async function save(data: TenantData, actor: { organizationId: string; userId: string }, values: Record<string, unknown>, change: string) {
  await data.transaction(actor.organizationId, async (tenant) => {
    await tenant.organizationBranding.createMany({ data: [{}], skipDuplicates: true });
    await tenant.organizationBranding.updateMany({ where: {}, data: values });
    await recordAudit(tenant, {
      action: "branding.updated", actorUserId: actor.userId, targetType: "organization", targetId: actor.organizationId, metadata: { change },
    });
  });
}

export async function setLogo(data: TenantData, actor: { organizationId: string; userId: string }, bytes: Uint8Array) {
  if (bytes.length === 0) throw new InputValidationError({ logo: "choose a PNG or JPEG file" });
  if (bytes.length > MAX_LOGO_BYTES) throw new InputValidationError({ logo: "must be at most 256 KB" });
  const info = imageInfo(bytes);
  if (!info) throw new InputValidationError({ logo: "must be a PNG or JPEG image" });
  if (info.width < MIN_SIDE || info.height < MIN_SIDE || info.width > MAX_SIDE || info.height > MAX_SIDE) {
    throw new InputValidationError({ logo: `must be between ${MIN_SIDE} and ${MAX_SIDE} pixels on each side` });
  }
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  await save(data, actor, { logo: Buffer.from(bytes), logoType: info.type, logoHash: hash }, "logo");
  return hash;
}

export async function removeLogo(data: TenantData, actor: { organizationId: string; userId: string }) {
  await save(data, actor, { logo: null, logoType: null, logoHash: null }, "logo_removed");
}

/** Accent colour for headings and rules on documents; must read clearly on white (3:1). Empty clears it. */
export async function setAccentColor(data: TenantData, actor: { organizationId: string; userId: string }, input: string) {
  const value = input.trim().toLowerCase();
  if (value && !/^#[0-9a-f]{6}$/.test(value)) throw new InputValidationError({ accentColor: "must be a colour like #1f6feb" });
  if (value && contrastWithWhite(value) < 3) throw new InputValidationError({ accentColor: "is too light to read on white; choose a darker colour" });
  await save(data, actor, { accentColor: value || null }, "accent_color");
}

/** Seller details for a PDF: name, formatting and branding. */
export async function pdfSeller(data: TenantData, organizationId: string, seller: { name: string; locale: string }) {
  const { logo, accentColor } = await getBranding(data, organizationId);
  return { seller: seller.name, locale: seller.locale, logo, accentColor };
}

/** Branding for a document page: the logo's public path and the accent colour. */
export async function documentBrand(data: TenantData, organizationId: string): Promise<{ logoUrl: string | null; accentColor: string | null }> {
  const { logo, accentColor } = await getBranding(data, organizationId);
  return { logoUrl: logo ? logoPath(organizationId, logo.hash) : null, accentColor };
}

/** The brand on emails about a workspace's documents: absolute logo URL (lib/email/template.ts). */
export async function emailBrand(tenant: TenantDb, organizationId: string, name: string, appUrl: string) {
  const row = await tenant.organizationBranding.findFirst({ select: { logoHash: true, accentColor: true } });
  return {
    name,
    logoUrl: row?.logoHash ? new URL(logoPath(organizationId, row.logoHash), appUrl).toString() : null,
    accentColor: row?.accentColor ?? null,
  };
}
