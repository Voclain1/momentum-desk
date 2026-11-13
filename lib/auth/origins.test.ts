import { describe, expect, it } from "vitest";
import { appOrigins } from "./origins";

describe("appOrigins", () => {
  it("uses and trusts APP_URL only", () => {
    expect(appOrigins({ APP_URL: "https://momentumdesk.app", VERCEL_URL: "md-abc123.vercel.app" })).toEqual({
      baseURL: "https://momentumdesk.app",
      trustedOrigins: ["https://momentumdesk.app"],
    });
  });

  it("leaves the origin to the request locally", () => {
    expect(appOrigins({})).toEqual({ baseURL: undefined, trustedOrigins: [] });
  });
});
