import { describe, expect, it } from "vitest";
import { CsvError, parseCsv, toCsv } from "./csv";

describe("parseCsv", () => {
  it("reads plain rows", () => {
    expect(parseCsv("a,b\n1,2\n")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("reads quoted commas, quotes and line breaks", () => {
    expect(parseCsv('name,notes\n"Okafor, Ltd","said ""hi""\nthen left"\n')).toEqual([
      ["name", "notes"],
      ["Okafor, Ltd", 'said "hi"\nthen left'],
    ]);
  });

  it("handles CRLF, a byte order mark and blank lines", () => {
    expect(parseCsv("﻿a,b\r\n\r\n1,2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("reads a last line without a newline, and empty cells", () => {
    expect(parseCsv("a,b,c\n1,,3")).toEqual([["a", "b", "c"], ["1", "", "3"]]);
  });

  it("rejects malformed quoting", () => {
    expect(() => parseCsv('a\n"open')).toThrow(CsvError);
    expect(() => parseCsv('a\nab"c"\n')).toThrow(CsvError);
  });
});

describe("toCsv", () => {
  it("round-trips through parseCsv", () => {
    const rows = [["Okafor, Ltd", 'said "hi"', "line\nbreak", ""]];
    const text = toCsv(["a", "b", "c", "d"], rows);
    expect(text.startsWith("﻿")).toBe(true);
    expect(text.endsWith("\r\n")).toBe(true);
    expect(parseCsv(text)).toEqual([["a", "b", "c", "d"], ...rows]);
  });

  it("writes null and undefined as empty, numbers as text", () => {
    expect(parseCsv(toCsv(["a", "b", "c"], [[null, undefined, 42]]))).toEqual([["a", "b", "c"], ["", "", "42"]]);
  });

  it("neutralises cells a spreadsheet would run as formulas", () => {
    const formulas = ['=HYPERLINK("http://evil")', "+1+1", "-2+3", "@SUM(A1)", "\t=1"];
    const [, cells] = parseCsv(toCsv(["x", "x", "x", "x", "x"], [formulas]));
    expect(cells).toEqual(formulas.map((value) => `'${value}`));
  });

  it("leaves ordinary values alone", () => {
    const [, cells] = parseCsv(toCsv(["a", "b", "c"], [["Ada Lovelace", "ada@example.com", "2026-01-31"]]));
    expect(cells).toEqual(["Ada Lovelace", "ada@example.com", "2026-01-31"]);
  });

  it("guards a phone number starting with +, which import restores", () => {
    const [, cells] = parseCsv(toCsv(["phone", "n"], [["+234 801", 42]]));
    expect(cells).toEqual(["'+234 801", "42"]);
  });
});
