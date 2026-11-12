import { createHash } from "node:crypto";
import type { DbClient } from "@/lib/db/client";

/**
 * Public document links (decision D16). A visitor to /q/{token} has no
 * session, so there is no organization to scope by yet. This is the one
 * query that runs without one, and it can read exactly one row: the link
 * whose token hash it sets for its own transaction (the quoteLink_token_lookup
 * policy). Everything after it runs as an ordinary tenant transaction for the
 * organization the link belongs to.
 */

/** Hex SHA-256 of a token. Tokens themselves are never stored. */
export const hashToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

/** Tokens are 32 random bytes in base64url (43 characters). Anything else is not a link. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export interface PublicLink {
  id: string;
  organizationId: string;
  quoteId: string;
  revokedAt: Date | null;
  /** The seller, for the page: name and formatting only. */
  organization: { name: string; locale: string; timezone: string };
}

export function createPublicLinks(db: DbClient) {
  return {
    async quoteLink(token: string): Promise<PublicLink | null> {
      if (!TOKEN.test(token)) return null;
      const tokenHash = hashToken(token);
      const link = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.quote_token_hash', ${tokenHash}, true)`;
        return tx.quoteLink.findUnique({
          where: { tokenHash },
          select: { id: true, organizationId: true, quoteId: true, revokedAt: true },
        });
      });
      if (!link) return null;
      const organization = await db.organization.findUnique({
        where: { id: link.organizationId },
        select: { name: true, locale: true, timezone: true },
      });
      return organization ? { ...link, organization } : null;
    },
  };
}
