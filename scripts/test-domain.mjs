/**
 * Offline fallback for dependency-free domain tests on Node >=22.18.
 * Uses the same test bodies/assertions as Vitest, not a replacement test suite.
 * Leaves repository sources untouched. Full pnpm check remains required.
 */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { stripTypeScriptTypes } from "node:module";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "momentum-domain-"));
const files = [
  "lib/money/currencies.ts",
  "lib/tenancy/authorization.ts", "lib/tenancy/authorization.test.ts",
  "lib/workspaces/settings.ts", "lib/workspaces/settings.test.ts",
  "lib/workspaces/service.ts", "lib/workspaces/service.test.ts",
];

try {
  for (const file of files) {
    const source = readFileSync(join(root, file), "utf8")
      .replace('from "vitest"', 'from "node:test"')
      .replace(/from "(\.[^"]+)"/g, 'from "$1.mjs"');
    const target = join(temporary, file.replace(/\.ts$/, ".mjs"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, stripTypeScriptTypes(source, { mode: "transform", sourceUrl: file }));
  }
  // Direct execution reliably reports nested tests in this managed runtime.
  for (const file of files.filter((file) => file.endsWith(".test.ts"))) {
    const result = spawnSync(process.execPath, [join(temporary, file.replace(/\.ts$/, ".mjs"))], { stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      break;
    }
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
