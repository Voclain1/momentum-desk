import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastWithWhite, imageInfo } from "./service";

const fixture = (name: string) => new Uint8Array(readFileSync(`test/fixtures/${name}`));

describe("logo checks", () => {
  it("reads the type and size from PNG and JPEG content", () => {
    expect(imageInfo(fixture("logo.png"))).toEqual({ type: "image/png", width: 120, height: 40 });
    expect(imageInfo(fixture("logo.jpg"))).toEqual({ type: "image/jpeg", width: 120, height: 40 });
  });

  it("refuses anything else, whatever it is called", () => {
    expect(imageInfo(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(imageInfo(new TextEncoder().encode("GIF89a........"))).toBeNull();
    expect(imageInfo(fixture("logo.png").slice(0, 12))).toBeNull();
  });

  it("measures colour contrast against white", () => {
    expect(contrastWithWhite("#ffffff")).toBeCloseTo(1, 2);
    expect(contrastWithWhite("#000000")).toBeCloseTo(21, 0);
    expect(contrastWithWhite("#1f3a5f")).toBeGreaterThan(3);
    expect(contrastWithWhite("#ffd400")).toBeLessThan(3);
  });
});
