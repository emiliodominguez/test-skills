import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { blockMessage, parsePayload } from "../skills/test-guard/scripts/guard-hook.mjs";

const HOOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../skills/test-guard/scripts/guard-hook.mjs");
const temporary: string[] = [];

/**
 * A repository with one committed test file whose second case is then skipped.
 *
 * @returns The repository directory.
 */
function weakenedRepository(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hook-"));
	const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
	const file = path.join(dir, "f.test.js");

	temporary.push(dir);
	fs.writeFileSync(file, 'test("a", () => {\n\texpect(f()).toBe(1);\n});\ntest("b", () => {\n\texpect(f()).toBe(2);\n});\n');
	execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir, env });
	execFileSync("git", ["add", "-A"], { cwd: dir, env });
	execFileSync("git", ["commit", "-qm", "base"], { cwd: dir, env });
	fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace('test("b"', 'test.skip("b"'));

	return dir;
}

/**
 * Run the hook with a payload on stdin.
 *
 * @param payload - JSON payload.
 * @param cwd - Working directory of the hook process.
 * @returns Exit status and standard error.
 */
function runHook(payload: unknown, cwd: string): { status: number | null; stderr: string } {
	const result = spawnSync("node", [HOOK, "--base", "HEAD"], { cwd, input: JSON.stringify(payload), encoding: "utf8" });

	return { status: result.status, stderr: result.stderr };
}

afterEach(function cleanUp() {
	for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("guard-hook", function hookSuite() {
	test("blocks a stop with exit 2 and names the weakened test", function blocks() {
		const dir = weakenedRepository();
		const result = runHook({ cwd: dir, stop_hook_active: false }, os.tmpdir());

		expect(result.status).toBe(2);
		expect(result.stderr).toContain("added-skip in f.test.js");
	});

	test("lets the second stop through", function secondStop() {
		expect(runHook({ cwd: weakenedRepository(), stop_hook_active: true }, os.tmpdir()).status).toBe(0);
	});

	test("stays out of the way outside a repository", function outside() {
		expect(runHook({}, os.tmpdir()).status).toBe(0);
	});

	test("parsePayload tolerates empty or invalid input", function payloads() {
		expect([parsePayload(""), parsePayload("nope"), parsePayload('{"cwd":"/x"}')]).toEqual([{}, {}, { cwd: "/x" }]);
	});

	test("blockMessage lists only errors", function message() {
		const text = blockMessage([
			{ level: "error", rule: "added-skip", file: "a.test.js", detail: "0 -> 1" },
			{ level: "warn", rule: "changed-expectation", file: "a.test.js", detail: "x" },
		]);

		expect(text).toContain("added-skip in a.test.js: 0 -> 1");
		expect(text).not.toContain("changed-expectation");
	});
});
