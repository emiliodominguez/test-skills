import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { changedExpectations, compareConfig, compareTestFile, countMarkers, isTestFile } from "../skills/test-guard/scripts/guard-tests.mjs";

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

describe("guard CLI edge cases found by mutation testing", function edgeSuite() {
	test("a test file renamed to a name the runner does not collect is a deleted test file", function hiddenRename() {
		const dir = repository({ "src/cart.test.js": suite });

		git(dir, "mv", "src/cart.test.js", "src/cart.js");

		const result = guard(dir, "--json", "--base", "HEAD");

		expect(result.rules).toEqual(["deleted-test-file"]);
		expect(JSON.parse(result.stdout).findings[0]).toMatchObject({
			file: "src/cart.js",
			detail: "renamed from src/cart.test.js; 2 tests no longer collected",
		});
	});

	test("a deleted snapshot is reported as deleted", function deletedSnapshot() {
		const dir = repository({ "src/__snapshots__/cart.test.js.snap": "exports[`a`] = `1`;\n", "src/cart.test.js": suite });

		fs.rmSync(path.join(dir, "src/__snapshots__/cart.test.js.snap"));

		expect(JSON.parse(guard(dir, "--json", "--base", "HEAD").stdout).findings).toEqual([
			expect.objectContaining({ rule: "updated-snapshots", detail: "snapshot deleted" }),
		]);
	});

	test("a snapshot change counts as a test change for a source change", function snapshotIsTestChange() {
		const dir = repository({ "src/cart.js": "export const a = 1;\n", "src/__snapshots__/cart.test.js.snap": "exports[`a`] = `1`;\n" });

		write(dir, { "src/cart.js": "export const a = 2;\n", "src/__snapshots__/cart.test.js.snap": "exports[`a`] = `2`;\n" });

		expect(guard(dir, "--json", "--base", "HEAD").rules).toEqual(["updated-snapshots"]);
	});

	test("a source change alone is reported as info", function sourceOnly() {
		const dir = repository({ "src/cart.js": "export const a = 1;\n", "src/cart.test.js": suite });

		write(dir, { "src/cart.js": "export const a = 2;\n" });

		expect(guard(dir, "--json", "--base", "HEAD")).toMatchObject({ status: 0, rules: ["no-test-changes"] });
	});

	test("a deleted test config is not a crash", function deletedConfig() {
		const dir = repository({ "src/cart.test.js": suite, "vitest.config.ts": "export default { retries: 0 };\n" });

		fs.rmSync(path.join(dir, "vitest.config.ts"));

		expect(guard(dir, "--json", "--base", "HEAD")).toMatchObject({ status: 0, rules: [] });
	});

	test("lists at most five removed test titles", function removedTitles() {
		const many = Array.from({ length: 8 }, function testCase(_, index) {
			return `test("case ${index}", () => {\n\texpect(${index}).toBe(${index});\n});\n`;
		}).join("");
		const findings = compareTestFile(many, "");
		const removed = findings.find(function isRemoved(finding: { rule: string }) {
			return finding.rule === "removed-tests";
		});

		expect(removed?.detail).toBe("8 -> 0 tests; gone: case 0 | case 1 | case 2 | case 3 | case 4");
	});
});

describe("guard config and expectation pairing", function pairingSuite() {
	test("adding the first retry is flagged", function firstRetry() {
		expect(compareConfig("export default {};\n", "export default { retries: 1 };\n")).toEqual([
			{ rule: "added-retries", detail: "retries 0 -> 1" },
		]);
	});

	test("exclusion detail keeps three lines and at most 160 characters", function exclusionDetail() {
		const after = ["exclude: ['a']", "exclude: ['b']", "exclude: ['c']", "exclude: ['d']"].join("\n");
		const [finding] = compareConfig("", after);

		expect(finding).toEqual({ rule: "excluded-tests", detail: "exclude: ['a'] | exclude: ['b'] | exclude: ['c']" });
		expect(compareConfig("", `exclude: ['${"x".repeat(300)}']`)[0]?.detail).toHaveLength(160);
	});

	test("changed-expectation detail is capped at 160 characters", function expectationDetail() {
		const diff = `@@ -1 +1 @@\n-expect(a).toBe(${"1".repeat(200)});\n+expect(a).toBe(2);\n`;

		expect(changedExpectations(diff)[0]?.detail).toHaveLength(160);
	});

	test("an expectation on another subject is not paired", function otherSubject() {
		expect(changedExpectations("@@ -1 +1 @@\n-expect(a).toBe(1);\n+expect(b).toBe(2);\n")).toEqual([]);
	});

	test("lines are paired within a hunk, not across hunks", function perHunk() {
		expect(changedExpectations("@@ -1 +0,0 @@\n-expect(a).toBe(1);\n@@ -0,0 +9 @@\n+expect(a).toBe(2);\n")).toEqual([]);
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
