import { describe, expect, it } from "vitest";
import { renderEmailHtml } from "./template";

describe("email HTML", () => {
  it("follows the text: paragraphs, a button for the action link, and escaped content", () => {
    const html = renderEmailHtml({
      subject: "Invoice INV-0001 from Sun <Power>",
      text: "Hello Ada,\n\nSun Power has sent you invoice INV-0001 <b>now</b>.\n\nView or download it here: https://momentumdesk.app/i/abc_DEF-123\n\nThanks.",
      brand: { name: "Sun Power", logoUrl: "https://momentumdesk.app/logo/org/0123456789abcdef", accentColor: "#1f3a5f" },
    });
    expect(html).toContain("<title>Invoice INV-0001 from Sun &lt;Power&gt;</title>");
    expect(html).toContain("invoice INV-0001 &lt;b&gt;now&lt;/b&gt;.");
    expect(html).not.toContain("<b>now</b>");
    expect(html).toContain('<a href="https://momentumdesk.app/i/abc_DEF-123" style="background:#1f3a5f;');
    expect(html).toContain(">View or download it here</a>");
    expect(html).toContain('<img src="https://momentumdesk.app/logo/org/0123456789abcdef" alt="Sun Power"');
    expect(html).toContain("Sent by Sun Power with MomentumDesk.");
  });

  it("uses the product name when an email is not about a business's documents", () => {
    const html = renderEmailHtml({ subject: "Your sign-in link", text: "Sign in: https://momentumdesk.app/x\n\nIt expires in 5 minutes." });
    expect(html).toContain(">MomentumDesk</strong>");
    expect(html).not.toContain("<img");
  });
});
