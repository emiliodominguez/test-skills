import { describe, expect, test } from "vitest";
import { auditConfig, auditFile, auditGo, auditJs, auditPython, isTestFile, maskJs } from "../skills/test-audit/scripts/audit-tests.mjs";

/**
 * Rule ids found in a source, in order.
 *
 * @param findings - Audit findings.
 * @returns Rule ids.
 */
function rulesOf(findings: Array<{ rule: string }>): string[] {
	return findings.map(function toRule(finding) {
		return finding.rule;
	});
}

describe("auditJs", function auditJsSuite() {
	test.each([
		["focused", 'it.only("adds", () => { expect(add(1, 2)).toBe(3); });'],
		["focused", 'describe.only("math", () => {});'],
		["skipped", 'test.skip("adds", () => { expect(add(1, 2)).toBe(3); });'],
		["skipped", 'xit("adds", () => { expect(add(1, 2)).toBe(3); });'],
		["no-assertion", 'test("adds", () => { add(1, 2); });'],
		["no-assertion", 'test.each([[1, 2]])("adds %i", (a, b) => { add(a, b); });'],
		["tautology", 'test("adds", () => { expect(true).toBe(true); });'],
		["tautology", 'test("adds", () => { const total = add(1, 2); expect(total).toBe(total); });'],
		["weak-assertion", 'test("adds", () => { expect(add(1, 2)).toBeDefined(); });'],
		["snapshot-only", 'test("renders", () => { expect(render()).toMatchSnapshot(); });'],
		["swallowed", 'test("saves", async () => { try { await save(); } catch {} expect(saved()).toBe(true); });'],
		["sleep", 'test("loads", async ({ page }) => { await page.waitForTimeout(500); await expect(page.getByRole("heading")).toBeVisible(); });'],
		["expected-failure", 'test.fails("known bug", () => { expect(add(1, 2)).toBe(4); });'],
	])("reports %s", function reports(rule, source) {
		expect(rulesOf(auditJs("math.test.ts", source))).toContain(rule);
	});

	test("reports a mock of the module under test", function mocksSubject() {
		expect(rulesOf(auditJs("src/cart.test.ts", 'vi.mock("./cart");\ntest("x", () => { expect(total()).toBe(3); });'))).toContain("mocks-subject");
	});

	test.each([
		['test("adds", () => { expect(add(1, 2)).toBe(3); });'],
		['test("visible", async ({ page }) => { await expect(page.getByRole("button", { name: "Pay" })).toBeVisible(); });'],
		['it("posts nothing", () => { expect(balance([])).toBeUndefined(); });'],
		['it("uses a helper", () => { assertBalanced(ledger()); });'],
		['it("cypress", () => { cy.get("button").should("be.visible"); });'],
		['const ok = /x/.test("x");'],
		['vi.mock("./clock");\ntest("x", () => { expect(total()).toBe(3); });'],
		['// it.only("old", () => {});\ntest("adds", () => { expect(add(1, 2)).toBe(3); });'],
		['test("label mentions expect(true).toBe(true)", () => { expect(add(1, 2)).toBe(3); });'],
	])("stays quiet on %s", function quiet(source) {
		expect(auditJs("math.test.ts", source)).toEqual([]);
	});

	test("honors an ignore comment for the named rule only", function ignores() {
		const source = '// audit-tests-ignore no-assertion: asserts through the page object\ntest("flow", () => { checkout(); });';

		expect(auditJs("flow.test.ts", source)).toEqual([]);
		expect(rulesOf(auditJs("flow.test.ts", source.replace("no-assertion", "sleep")))).toEqual(["no-assertion"]);
	});

	test("reports the line of each finding", function lines() {
		expect(auditJs("math.test.ts", '\n\ntest("adds", () => {\n\tadd(1, 2);\n});')).toMatchObject([{ line: 3, rule: "no-assertion" }]);
	});
});

describe("auditPython", function auditPythonSuite() {
	test("reports skips, missing assertions, tautologies and sleeps", function python() {
		const source = [
			"import time",
			"",
			"@pytest.mark.skip(reason='later')",
			"def test_skipped():",
			"    assert add(1, 2) == 3",
			"",
			"def test_nothing():",
			"    add(1, 2)",
			"",
			"def test_true():",
			"    assert True",
			"",
			"def test_slow():",
			"    time.sleep(1)",
			"    assert ready()",
			"",
			"def test_raises():",
			"    with pytest.raises(ValueError):",
			"        parse('x')",
		].join("\n");

		expect(rulesOf(auditPython(source))).toEqual(["skipped", "no-assertion", "tautology", "sleep"]);
	});
});

describe("auditGo", function auditGoSuite() {
	test("reports tests that never fail and skips", function go() {
		const source =
			'func TestAdd(t *testing.T) {\n\tadd(1, 2)\n}\n\nfunc TestSub(t *testing.T) {\n\tif sub(2, 1) != 1 {\n\t\tt.Errorf("bad")\n\t}\n}\n\nfunc TestLater(t *testing.T) {\n\tt.Skip("later")\n}';

		expect(rulesOf(auditGo(source))).toEqual(["skipped", "no-assertion", "no-assertion"]);
	});
});

describe("configs and helpers", function helpers() {
	test("reports retries in runner configs", function retries() {
		expect(rulesOf(auditConfig("export default { retries: process.env.CI ? 2 : 0 };"))).toEqual(["retries"]);
		expect(auditConfig("export default { retries: 0 };")).toEqual([]);
	});

	test("routes files by kind", function routes() {
		expect(rulesOf(auditFile("playwright.config.ts", "retries: 3"))).toEqual(["retries"]);
		expect(rulesOf(auditFile("test_cart.py", "def test_x():\n    pass"))).toEqual(["no-assertion"]);
	});

	test.each([
		["src/cart.test.ts", true],
		["src/__tests__/cart.tsx", true],
		["e2e/checkout.spec.js", true],
		["tests/test_cart.py", true],
		["cart_test.go", true],
		["src/cart.ts", false],
		["src/testing.ts", false],
	])("isTestFile(%s) is %s", function classifies(file, expected) {
		expect(isTestFile(file)).toBe(expected);
	});

	test("maskJs blanks strings and comments but keeps offsets", function masks() {
		const source = 'a("x.only(") // it.only(\nb';

		expect(maskJs(source)).toHaveLength(source.length);
		expect(maskJs(source)).not.toContain("only");
		expect(maskJs(source).split("\n")).toHaveLength(2);
	});
});
