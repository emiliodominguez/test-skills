#!/usr/bin/env node
// Runs every `examples/*/verify.mjs`: each proves a skill's claim end to end (a seeded bug is
// caught, the fixed version passes) and exits 0 only when every check holds. These need a browser
// (set CHROME if Chromium is not found), so they run in `pnpm verify`, not `pnpm check`.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const examples = readdirSync(join(root, "examples"), { withFileTypes: true })
	.filter(function hasVerify(entry) {
		return entry.isDirectory() && existsSync(join(root, "examples", entry.name, "verify.mjs"));
	})
	.map(function toName(entry) {
		return entry.name;
	})
	.sort();
let failed = 0;

for (const name of examples) {
	const result = spawnSync(process.execPath, [join(root, "examples", name, "verify.mjs")], { cwd: root, stdio: "inherit" });

	console.log(`${result.status === 0 ? "ok  " : "FAIL"}  examples/${name}/verify.mjs`);
	if (result.status !== 0) failed += 1;
}

console.log(`\n${examples.length - failed}/${examples.length} example verifications passed.`);
process.exitCode = failed > 0 ? 1 : 0;
