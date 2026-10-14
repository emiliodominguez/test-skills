import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { auditFile, auditJs, collectFiles, formatReport, maskJs, regexLiteralEnd } from "../skills/test-audit/scripts/audit-tests.mjs";

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../skills/test-audit/scripts/audit-tests.mjs");
const temporary: string[] = [];

/**
 * A project with the given files.
 *
 * @param files - Paths and contents.
 * @returns Project directory.
 */
function project(files: Record<string, string>): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-cli-"));

	temporary.push(dir);

	for (const [file, content] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
		fs.writeFileSync(path.join(dir, file), content);
	}

	return dir;
}

/**
 * Run the CLI in a directory.
 *
 * @param cwd - Working directory.
 * @param args - CLI arguments.
 * @returns Exit status and output.
 */
function cli(cwd: string, ...args: string[]): { status: number | null; stdout: string; stderr: string } {
	const result = spawnSync("node", [SCRIPT, ...args], { cwd, encoding: "utf8" });

	return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/**
 * Rule ids of findings.
 *
 * @param findings - Findings.
 * @returns Rule ids.
 */
function rulesOf(findings: Array<{ rule: string }>): string[] {
	return findings.map(function toRule(finding) {
		return finding.rule;
	});
}

const good = 'test("adds", () => { expect(add(1, 2)).toBe(3); });\n';
const sleepy = 'test("adds", async () => { await sleep(10); expect(add(1, 2)).toBe(3); });\n';
const empty = 'test("adds", () => { add(1, 2); });\n';

afterEach(function cleanUp() {
	for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("the audit CLI", function cliSuite() {
	test("exits 0 on a clean suite and says so", function clean() {
		const result = cli(project({ "src/a.test.ts": good }));

		expect(result.status).toBe(0);
		expect(result.stdout).toBe("audit-tests: 1 files, no findings.\n");
	});

	test("exits 0 on warnings by default and 1 with --fail-on warn", function warnings() {
		const dir = project({ "src/a.test.ts": sleepy });

		expect(cli(dir).status).toBe(0);
		expect(cli(dir, "--fail-on", "warn").status).toBe(1);
		expect(cli(dir, "--fail-on", "error").status).toBe(0);
	});

	test("exits 1 on errors and reports them with counts and advice", function errors() {
		const result = cli(project({ "a.test.ts": `${empty}${empty}`, "b.test.ts": sleepy }));

		expect(result.status).toBe(1);
		expect(result.stdout).toContain("a.test.ts:1  error  no-assertion");
		expect(result.stdout).toContain("audit-tests: 2 files, 3 findings");
		expect(result.stdout).toMatch(/ {5}2 {2}no-assertion: .+\n {5}1 {2}sleep: /u);
	});

	test("reads only the given paths, and the first one too", function paths() {
		const dir = project({ "one/a.test.ts": empty, "two/b.test.ts": good, "three/c.test.ts": empty });
		const result = cli(dir, "--json", "one", "two");

		expect(JSON.parse(result.stdout)).toMatchObject({
			scanned: 2,
			findings: [{ file: path.join("one", "a.test.ts"), rule: "no-assertion", level: "error", line: 1 }],
		});
	});

	test("does not read --fail-on's value as a path", function failOnValue() {
		const dir = project({ "warn/a.test.ts": empty, "x/b.test.ts": good });

		expect(JSON.parse(cli(dir, "--fail-on", "warn", "--json", "x").stdout).scanned).toBe(1);
	});

	test("rejects an unknown level and a missing path with exit 2", function usage() {
		const dir = project({ "a.test.ts": good });

		expect(cli(dir, "--fail-on", "loud")).toMatchObject({ status: 2, stderr: "--fail-on must be info, warn or error\n" });
		expect(cli(dir, "nope").status).toBe(2);
	});

	test("skips dependency and build folders", function skips() {
		const dir = project({ "node_modules/x/a.test.ts": empty, "dist/b.test.ts": empty, "src/c.test.ts": good });

		expect(collectFiles([dir])).toEqual([path.join(dir, "src", "c.test.ts")]);
	});
});

describe("masking and parsing details", function details() {
	test("block comments hide focus markers until they close", function blockComments() {
		expect(rulesOf(auditJs("a.test.ts", `/* it.only("x", f) */ ${good}`))).toEqual([]);
		expect(rulesOf(auditJs("a.test.ts", `/* note */ it.only("x", () => { expect(1).toBe(2); });`))).toEqual(["focused"]);
	});

	test("a slash inside a character class does not end the regex", function classSlash() {
		const source = "x = /[/]it.only(/u; it.only(1);";

		expect(regexLiteralEnd(source, 4)).toBe(source.indexOf(";"));
		// The pattern, the closing slash and the flags are blanked; the code after it stays visible.
		expect(maskJs(source)).toBe(`x = /${" ".repeat(13)}; it.only(1);`);
	});

	test("keywords allow a regex and identifiers mean division", function keywords() {
		expect(regexLiteralEnd("return /a/g", 7)).toBe(11);
		expect(regexLiteralEnd("returned /a/g", 9)).toBe(-1);
		expect(regexLiteralEnd("/a/", 0)).toBe(3);
		expect(regexLiteralEnd("x = /a\\/b/", 4)).toBe(10);
	});

	test("tagged test.each tables and every skip modifier", function eachAndSkips() {
		expect(rulesOf(auditJs("a.test.ts", 'test.each`\na | b\n${1} | ${2}\n`("adds", ({ a, b }) => { add(a, b); });'))).toEqual(["no-assertion"]);

		for (const modifier of ["skip", "todo", "fixme"])
			expect(rulesOf(auditJs("a.test.ts", `test.${modifier}("x", () => {});`))).toEqual(["skipped"]);
	});

	test("an index file counts as the module it names", function indexMocks() {
		expect(rulesOf(auditJs("src/cart.test.ts", `vi.mock("./cart/index");\n${good}`))).toEqual(["mocks-subject"]);
		expect(rulesOf(auditJs("src/cart.test.ts", `vi.mock("./other/index");\n${good}`))).toEqual([]);
	});

	test("Python decorators only skip the function they decorate", function pythonDecorators() {
		const source = ["@pytest.mark.skip(reason='later')", "def test_one():", "    pass", "", "", "", "def test_two():", "    pass"].join("\n");

		expect(rulesOf(auditFile("test_x.py", source))).toEqual(["skipped", "no-assertion"]);
	});

	test("routes Go files to the Go audit", function goRouting() {
		expect(rulesOf(auditFile("cart_test.go", "func TestAdd(t *testing.T) {\n\tadd(1, 2)\n}"))).toEqual(["no-assertion"]);
	});

	test("formatReport sorts rules by count", function report() {
		const text = formatReport(
			[
				{ file: "a", line: 1, rule: "sleep", level: "warn", detail: "x" },
				{ file: "a", line: 2, rule: "skipped", level: "warn", detail: "y" },
				{ file: "a", line: 3, rule: "skipped", level: "warn", detail: "z" },
			],
			1,
		);

		expect(text.indexOf("skipped:")).toBeLessThan(text.indexOf("sleep:"));
		expect(text).toContain("audit-tests: 1 files, 3 findings");
	});
});

describe("checks of newer test kinds", function newerKinds() {
	test("a screenshot comparison is a visual test, not snapshot-only", function screenshot() {
		expect(auditJs("home.spec.ts", 'test("home", async function home({ page }) { await expect(page).toHaveScreenshot(); });')).toEqual([]);
		expect(rulesOf(auditJs("view.test.ts", 'test("view", function view() { expect(render()).toMatchSnapshot(); });'))).toEqual(["snapshot-only"]);
	});

	test("a property test with one or two runs is flagged in JavaScript and Python", function tinyBudget() {
		expect(rulesOf(auditJs("p.test.ts", 'test("p", function p() { fc.assert(fc.property(fc.nat(), check), { numRuns: 1 }); });'))).toEqual([
			"tiny-budget",
		]);
		expect(auditJs("p.test.ts", 'test("p", function p() { fc.assert(fc.property(fc.nat(), check), { numRuns: 10 }); });')).toEqual([]);
		expect(rulesOf(auditFile("test_p.py", "@settings(max_examples=2)\n@given(st.integers())\ndef test_p(n):\n    assert f(n) >= 0\n"))).toEqual([
			"tiny-budget",
		]);
	});
});
