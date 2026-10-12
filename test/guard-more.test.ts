import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { changedExpectations, compareTestFile, countMarkers, isTestFile } from "../skills/test-guard/scripts/guard-tests.mjs";

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../skills/test-guard/scripts/guard-tests.mjs");
const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const temporary: string[] = [];
const suite = 'test("sums", () => {\n\texpect(total([1, 2])).toBe(3);\n});\ntest("empty", () => {\n\texpect(total([])).toBe(0);\n});\n';

/**
 * Run git.
 *
 * @param cwd - Repository.
 * @param args - Arguments.
 * @returns Output.
 */
function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd, env: ENV, encoding: "utf8" });
}

/**
 * Write files into a directory.
 *
 * @param dir - Directory.
 * @param files - Paths and contents.
 */
function write(dir: string, files: Record<string, string>): void {
	for (const [file, content] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
		fs.writeFileSync(path.join(dir, file), content);
	}
}

/**
 * A repository with the files committed on main.
 *
 * @param files - Paths and contents.
 * @returns Repository directory.
 */
function repository(files: Record<string, string>): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-more-"));

	temporary.push(dir);
	git(dir, "init", "-q", "-b", "main");
	write(dir, files);
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");

	return dir;
}

/**
 * Run the guard CLI.
 *
 * @param cwd - Repository.
 * @param args - Arguments.
 * @returns Status, rules found and raw output.
 */
function guard(cwd: string, ...args: string[]): { status: number | null; rules: string[]; stdout: string; stderr: string } {
	const result = spawnSync("node", [SCRIPT, ...args], { cwd, env: ENV, encoding: "utf8" });
	let rules: string[] = [];

	try {
		rules = JSON.parse(result.stdout)
			.findings.map(function toRule(finding: { rule: string }) {
				return finding.rule;
			})
			.sort();
	} catch {
		// Human-readable output.
	}

	return { status: result.status, rules, stdout: result.stdout, stderr: result.stderr };
}

afterEach(function cleanUp() {
	for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("guard CLI against a repository", function cliSuite() {
	test("defaults to the merge base with main, so committed weakening on a branch is caught", function mergeBase() {
		const dir = repository({ "src/cart.test.js": suite });

		git(dir, "checkout", "-qb", "feature");
		write(dir, { "src/cart.test.js": suite.replace('test("empty"', 'test.skip("empty"') });
		git(dir, "commit", "-qam", "skip");

		expect(guard(dir, "--json").rules).toEqual(["added-skip"]);
		expect(guard(dir, "--json", "--base", "HEAD").rules).toEqual([]);
		expect(guard(dir).stdout).toMatch(/guard-tests vs merge base [0-9a-f]{12}: WEAKENED \(1 errors, 0 other\)/u);
	});

	test("names the given base in the report", function label() {
		const dir = repository({ "src/cart.test.js": suite });

		write(dir, { "src/cart.test.js": suite.replace("toBe(3)", "toBeDefined()") });

		expect(guard(dir, "--base", "main").stdout).toContain("guard-tests vs main: WEAKENED (1 errors, 1 other)");
	});

	test("rejects an unknown base with exit 2", function unknownBase() {
		const dir = repository({ "src/cart.test.js": suite });
		const result = guard(dir, "--base", "no-such-ref");

		expect(result.status).toBe(2);
		expect(result.stderr).toMatch(/^guard-tests: /u);
	});

	test("compares a renamed test file with its old content", function renamed() {
		const dir = repository({ "src/cart.test.js": suite });

		git(dir, "mv", "src/cart.test.js", "src/basket.test.js");
		write(dir, { "src/basket.test.js": suite.split('test("empty"')[0]! });

		expect(guard(dir, "--json", "--base", "HEAD").rules).toEqual(["removed-assertions", "removed-tests"]);
	});

	test("flags a changed snapshot but not a new one", function snapshots() {
		const dir = repository({ "src/__snapshots__/cart.test.js.snap": "exports[`a`] = `1`;\n", "src/cart.test.js": suite });

		write(dir, { "src/__snapshots__/cart.test.js.snap": "exports[`a`] = `2`;\n", "src/__snapshots__/new.test.js.snap": "exports[`b`] = `1`;\n" });

		expect(guard(dir, "--json", "--base", "HEAD").rules).toEqual(["updated-snapshots"]);
	});

	test("accepts new test files and a source change with its test change", function additions() {
		const dir = repository({ "src/cart.js": "export const a = 1;\n", "src/cart.test.js": suite });

		write(dir, {
			"src/cart.js": "export const a = 2;\n",
			"src/cart.test.js": `${suite}test("more", () => {\n\texpect(total([2])).toBe(2);\n});\n`,
			"src/new.test.js": suite,
		});

		expect(guard(dir, "--json", "--base", "HEAD")).toMatchObject({ status: 0, rules: [] });
	});

	test("ignores a deleted source file and an unrelated config", function unrelated() {
		const dir = repository({
			"src/old.js": "export const a = 1;\n",
			"src/cart.test.js": suite,
			"vitest.config.ts": "export default { retries: 0 };\n",
		});

		fs.rmSync(path.join(dir, "src/old.js"));
		write(dir, { "vitest.config.ts": "export default { retries: 0, reporters: ['dot'] };\n" });

		expect(guard(dir, "--json", "--base", "HEAD")).toMatchObject({ status: 0, rules: [] });
	});
});

describe("guard helpers", function helpers() {
	test.each([
		["src/__tests__/cart.ts", true],
		["tests/test_cart.py", true],
		["pkg/cart_test.go", true],
		["src/cart.ts", false],
	])("isTestFile(%s) is %s", function classifies(file, expected) {
		expect(isTestFile(file)).toBe(expected);
	});

	test("more weak matchers without fewer exact ones is not a weakening", function notWeakened() {
		const before = "expect(a).toBe(1);\n";
		const after = "expect(a).toBe(1);\nexpect(b).toBeDefined();\n";

		expect(compareTestFile(before, after)).toEqual([]);
	});

	test("pairs node assert lines and ignores diff headers", function nodeAssert() {
		const diff = ["--- a/x.test.js", "+++ b/x.test.js", "@@ -1 +1 @@", "-assert.equal(total([1]), 1);", "+assert.equal(total([1]), 2);"].join(
			"\n",
		);

		expect(changedExpectations(diff)).toEqual([{ rule: "changed-expectation", detail: "assert.equal(total([1]): 1 -> 2" }]);
	});

	test("an added line alone is not a changed expectation", function addedOnly() {
		expect(changedExpectations("@@ -0,0 +1 @@\n+expect(a).toBe(1);")).toEqual([]);
	});

	test("counts every kind of focus and skip marker", function markers() {
		expect(countMarkers('fit(); fdescribe(); describe.only(); xit(); xdescribe(); test.todo(); @pytest.mark.xfail\nt.Skipf("x")')).toEqual({
			focus: 3,
			skip: 5,
		});
	});
});
