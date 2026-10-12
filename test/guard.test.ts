import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import {
	changedExpectations,
	compareConfig,
	compareTestFile,
	isSnapshot,
	isTestConfig,
	testTitles,
} from "../skills/test-guard/scripts/guard-tests.mjs";

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../skills/test-guard/scripts/guard-tests.mjs");
const temporary: string[] = [];

/**
 * Rule ids of findings.
 *
 * @param findings - Guard findings.
 * @returns Rule ids.
 */
function rulesOf(findings: Array<{ rule: string }>): string[] {
	return findings.map(function toRule(finding) {
		return finding.rule;
	});
}

/**
 * Run git in a directory.
 *
 * @param cwd - Repository directory.
 * @param args - Git arguments.
 * @returns Standard output.
 */
function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
	});
}

/**
 * Create a repository with files committed on `main`.
 *
 * @param files - Paths and contents.
 * @returns Repository directory.
 */
function repository(files: Record<string, string>): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-"));

	temporary.push(dir);
	git(dir, "init", "-q", "-b", "main");

	for (const [file, content] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
		fs.writeFileSync(path.join(dir, file), content);
	}

	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");

	return dir;
}

/**
 * Run the guard script.
 *
 * @param cwd - Repository directory.
 * @param args - Extra arguments.
 * @returns Exit status and parsed JSON findings.
 */
function runGuard(cwd: string, ...args: string[]): { status: number; rules: string[] } {
	try {
		const out = execFileSync("node", [SCRIPT, "--json", ...args], { cwd, encoding: "utf8" });

		return { status: 0, rules: rulesOf(JSON.parse(out).findings) };
	} catch (error) {
		const failure = error as { status: number; stdout: string };

		return { status: failure.status, rules: failure.stdout ? rulesOf(JSON.parse(failure.stdout).findings) : [] };
	}
}

const cartTest = [
	'import { total } from "./cart";',
	'test("sums lines", () => {',
	"\texpect(total([1, 2])).toBe(3);",
	"});",
	'test("empty cart is free", () => {',
	"\texpect(total([])).toBe(0);",
	"});",
	"",
].join("\n");

afterEach(function cleanUp() {
	for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("compareTestFile", function compareSuite() {
	test("reports removed tests by title", function removed() {
		const after = cartTest.split('test("empty')[0]!;

		expect(compareTestFile(cartTest, after)).toEqual([
			{ rule: "removed-tests", detail: "2 -> 1 tests; gone: empty cart is free" },
			{ rule: "removed-assertions", detail: "2 -> 1 assertions" },
		]);
	});

	test("reports new skip and focus markers", function markers() {
		expect(
			rulesOf(compareTestFile(cartTest, cartTest.replace('test("sums', 'test.only("sums').replace('test("empty', 'test.skip("empty'))),
		).toEqual(["added-focus", "added-skip"]);
	});

	test("reports an exact assertion replaced by an existence check", function weakened() {
		expect(rulesOf(compareTestFile(cartTest, cartTest.replace("toBe(3)", "toBeDefined()")))).toEqual(["weakened-assertion"]);
	});

	test("accepts a renamed test with the same strength", function renamed() {
		expect(compareTestFile(cartTest, cartTest.replace("sums lines", "adds line amounts"))).toEqual([]);
	});

	test("counts titles across languages", function titles() {
		expect(testTitles('it("a", f); test.each([1])("b", f);\ndef test_c():\n    pass\nfunc TestD(t *testing.T) {}')).toEqual([
			"a",
			"b",
			"test_c",
			"TestD",
		]);
	});
});

describe("changedExpectations", function expectationsSuite() {
	test("pairs a rewritten expected value with its subject", function rewritten() {
		const diff = ["@@ -3 +3 @@", "-\texpect(total([1, 2])).toBe(3);", "+\texpect(total([1, 2])).toBe(4);"].join("\n");

		expect(changedExpectations(diff)).toEqual([{ rule: "changed-expectation", detail: "expect(total([1, 2])): .toBe(3) -> .toBe(4)" }]);
	});

	test("pairs Python assertions", function python() {
		expect(rulesOf(changedExpectations("@@ -1 +1 @@\n-    assert total([1, 2]) == 3\n+    assert total([1, 2]) == 4"))).toEqual([
			"changed-expectation",
		]);
	});

	test("ignores a changed subject with the same expectation", function subject() {
		expect(changedExpectations("@@ -1 +1 @@\n-expect(total(a)).toBe(3);\n+expect(sum(a)).toBe(3);")).toEqual([]);
	});
});

describe("compareConfig", function configSuite() {
	test("reports lowered thresholds, added retries and exclusions", function weakenedConfig() {
		const before = "export default { test: { coverage: { thresholds: { lines: 80, branches: 75 } } }, retries: 0 };";
		const after = 'export default { test: { coverage: { thresholds: { lines: 60, branches: 75 } }, exclude: ["src/payments/**"] }, retries: 2 };';

		expect(rulesOf(compareConfig(before, after))).toEqual(["lowered-threshold", "added-retries", "excluded-tests"]);
	});

	test("accepts raised thresholds", function raised() {
		expect(compareConfig("[tool.coverage.report]\nfail_under = 80", "[tool.coverage.report]\nfail_under = 85")).toEqual([]);
	});
});

describe("classification", function classification() {
	test.each([
		["src/__snapshots__/cart.test.ts.snap", true],
		["e2e/home.spec.ts-snapshots/home-chromium.png", true],
		["src/cart.ts", false],
	])("isSnapshot(%s) is %s", function snapshot(file, expected) {
		expect(isSnapshot(file)).toBe(expected);
	});

	test.each([
		["vitest.config.ts", true],
		["pyproject.toml", true],
		[".github/workflows/ci.yml", true],
		["src/config.ts", false],
	])("isTestConfig(%s) is %s", function config(file, expected) {
		expect(isTestConfig(file)).toBe(expected);
	});
});

describe("the guard script", function script() {
	test("passes when tests only get stronger", function stronger() {
		const dir = repository({ "src/cart.test.ts": cartTest });

		fs.writeFileSync(path.join(dir, "src/cart.test.ts"), `${cartTest}test("three lines", () => {\n\texpect(total([1, 2, 3])).toBe(6);\n});\n`);

		expect(runGuard(dir, "--base", "HEAD")).toEqual({ status: 0, rules: [] });
	});

	test("fails when an agent deletes, skips and bends tests", function weakened() {
		const dir = repository({
			"src/cart.test.ts": cartTest,
			"src/legacy.test.ts": cartTest,
			"vitest.config.ts": "export default { retries: 0 };",
		});

		fs.writeFileSync(path.join(dir, "src/cart.test.ts"), cartTest.replace("toBe(3)", "toBe(4)").replace('test("empty', 'test.skip("empty'));
		fs.rmSync(path.join(dir, "src/legacy.test.ts"));
		fs.writeFileSync(path.join(dir, "vitest.config.ts"), "export default { retries: 3 };");

		const result = runGuard(dir, "--base", "HEAD");

		expect(result.status).toBe(1);
		expect(result.rules.sort()).toEqual(["added-retries", "added-skip", "changed-expectation", "deleted-test-file"]);
	});

	test("notes source changes without test changes", function untested() {
		const dir = repository({ "src/cart.ts": "export const x = 1;\n", "src/cart.test.ts": cartTest });

		fs.writeFileSync(path.join(dir, "src/cart.ts"), "export const x = 2;\n");

		expect(runGuard(dir, "--base", "HEAD")).toEqual({ status: 0, rules: ["no-test-changes"] });
	});
});
