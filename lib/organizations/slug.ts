const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_LENGTH = 48;

/** Lower-case words separated by single hyphens, as the database also enforces. */
export function isValidSlug(slug: string): boolean {
  return slug.length <= MAX_LENGTH && SLUG.test(slug);
}

/**
 * Derives a URL slug from a workspace name, e.g. "Ọ̀yọ́ Solar & Co." → "oyo-solar-co".
 * Returns "workspace" when nothing usable is left.
 */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_LENGTH)
    .replace(/-+$/, "");
  return slug || "workspace";
}
