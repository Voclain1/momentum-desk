import type { EmailMessage } from "./index";

/**
 * The HTML version of every transactional email (spec M7), made from its
 * plain text so the two never disagree. Paragraphs are separated by blank
 * lines; a paragraph ending "label: https://…" becomes a button. Emails
 * about a business's documents carry its logo and accent colour.
 */

export interface EmailBrand {
  name: string;
  /** Absolute URL of the logo, or null. */
  logoUrl: string | null;
  accentColor: string | null;
}

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;
const linkify = (escaped: string, color: string) =>
  escaped.replace(URL_PATTERN, (url) => `<a href="${url}" style="color:${color};word-break:break-all">${url}</a>`);

export function renderEmailHtml(message: Pick<EmailMessage, "subject" | "text" | "brand">): string {
  const accent = message.brand?.accentColor ?? "#1f3a5f";
  const paragraphs = message.text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  const body = paragraphs
    .map((block) => {
      const action = /^(.{3,80}?):\s*(https?:\/\/\S+)$/.exec(block);
      if (action && !action[1].includes("\n")) {
        const [, label, url] = action;
        return (
          `<p style="margin:24px 0"><a href="${escape(url)}" style="background:${accent};color:#ffffff;padding:12px 18px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600">${escape(label)}</a></p>` +
          `<p style="margin:0 0 16px;font-size:12px;color:#5c6b66">Or open this link: ${linkify(escape(url), accent)}</p>`
        );
      }
      return `<p style="margin:0 0 16px">${linkify(escape(block), accent).replace(/\n/g, "<br>")}</p>`;
    })
    .join("");
  const brand = message.brand;
  const header = brand?.logoUrl
    ? `<img src="${escape(brand.logoUrl)}" alt="${escape(brand.name)}" style="max-height:48px;max-width:180px;display:block">`
    : `<strong style="font-size:16px;color:${accent}">${escape(brand?.name ?? "MomentumDesk")}</strong>`;
  return [
    "<!doctype html>",
    `<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(message.subject)}</title></head>`,
    `<body style="margin:0;padding:0;background:#f4f6f5">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f5"><tr><td align="center" style="padding:24px 12px">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;border-top:4px solid ${accent}">`,
    `<tr><td style="padding:24px 28px 8px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">${header}</td></tr>`,
    `<tr><td style="padding:8px 28px 12px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#17201d">${body}</td></tr>`,
    `<tr><td style="padding:12px 28px 24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:#7a8a85">${brand ? `Sent by ${escape(brand.name)} with MomentumDesk.` : "MomentumDesk"}</td></tr>`,
    `</table></td></tr></table></body></html>`,
  ].join("");
}
