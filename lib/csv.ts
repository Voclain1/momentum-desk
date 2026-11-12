/**
 * CSV reading and writing (RFC 4180), small enough not to need a dependency.
 * Used for customer and lead import/export (spec §7.3).
 */

export class CsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvError";
  }
}

/**
 * Parses CSV text into rows of cells. Handles quoted fields (with commas,
 * doubled quotes and line breaks), CRLF or LF line endings, a UTF-8 byte
 * order mark and a last line without a newline. Blank lines are dropped.
 * Malformed quoting throws CsvError rather than guessing.
 */
export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      if (field.length > 0) throw new CsvError(`Unexpected quote on line ${rows.length + 1}`);
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (quoted) throw new CsvError("A quoted field is not closed");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

/**
 * One cell, quoted when needed. A value a spreadsheet would run as a formula
 * (starting with = + - @, tab or carriage return) gets a leading apostrophe,
 * so an exported file cannot execute anything when opened (CSV injection).
 * Import strips that apostrophe again.
 */
function safeCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

/** A CSV file with a header row: UTF-8 with a byte order mark (for Excel), CRLF line endings. */
export function toCsv(header: readonly string[], rows: readonly unknown[][]): string {
  return "﻿" + [header, ...rows].map((cells) => cells.map(safeCell).join(",")).join("\r\n") + "\r\n";
}
