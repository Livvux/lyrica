import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const output = mkdtempSync(path.join(tmpdir(), "lyrica-tests-"));

function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

try {
  const compiled = run([
    require.resolve("typescript/bin/tsc"),
    "--project", "tsconfig.test.json",
    "--outDir", output,
  ]);
  if (compiled !== 0) {
    process.exitCode = compiled;
  } else {
    const tests = readdirSync(path.join(output, "tests"))
      .filter((file) => file.endsWith(".test.js"))
      .sort()
      .map((file) => path.join(output, "tests", file));
    if (tests.length === 0) throw new Error("No compiled tests found");
    process.exitCode = run(["--test", ...tests]);
  }
} finally {
  rmSync(output, { recursive: true, force: true });
}
