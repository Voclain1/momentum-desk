import { describe, expect, it } from "vitest";
import { appOrigins } from "./origins";

describe("appOrigins", () => {
  it("uses APP_URL in production and also trusts Vercel's own hosts", () => {
    expect(
      appOrigins({
        APP_URL: "https://momentumdesk.app",
        VERCEL_URL: "momentum-desk-abc123.vercel.app",
        VERCEL_PROJECT_PRODUCTION_URL: "momentumdesk.app",
      }),
    ).toEqual({
      baseURL: "https://momentumdesk.app",
      trustedOrigins: ["https://momentumdesk.app", "https://momentum-desk-abc123.vercel.app"],
    });
  });

  it("serves a preview from its deployment URL and trusts its branch URL", () => {
    expect(
      appOrigins({ VERCEL_URL: "md-abc123.vercel.app", VERCEL_BRANCH_URL: "md-git-feature.vercel.app" }),
    ).toEqual({
      baseURL: "https://md-abc123.vercel.app",
      trustedOrigins: ["https://md-abc123.vercel.app", "https://md-git-feature.vercel.app"],
    });
  });

  it("leaves the origin to the request locally", () => {
    expect(appOrigins({})).toEqual({ baseURL: undefined, trustedOrigins: [] });
  });
});
