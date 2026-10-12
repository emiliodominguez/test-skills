import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { applyMutant, generateMutants, mask, parseArgs, sample } from "../skills/test-audit/scripts/mutate.mjs";

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../skills/test-audit/scripts/mutate.mjs");
const temporary: string[] = [];

const pricing = ["export function discount(total, member) {", "\tif (total >= 100 && member) return total * 0.9;", "\treturn total;", "}", ""].join(
	"\n",
);

/**
 * Write a pricing module and a test file into a temporary directory.
 *
 * @param assertions - Body of the test file.
 * @returns The directory.
 */
function fixture(assertions: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mutate-"));

	temporary.push(dir);
	fs.writeFileSync(path.join(dir, "pricing.mjs"), pricing);
	fs.writeFileSync(
		path.join(dir, "pricing.test.mjs"),
		`import assert from "node:assert/strict";\nimport { discount } from "./pricing.mjs";\n${assertions}\n`,
	);

	return dir;
}

/**
 * Run the mutation script with JSON output.
 *
 * @param dir - Fixture directory.
 * @returns Parsed report.
 */
function mutate(dir: string): { mutants: number; score: number; survived: Array<{ operator: string; replacement: string; line: number }> } {
	return JSON.parse(
		execFileSync("node", [SCRIPT, "--file", "pricing.mjs", "--json", "--", "node", "pricing.test.mjs"], { cwd: dir, encoding: "utf8" }),
	);
}

afterEach(function cleanUp() {
	for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("generateMutants", function generateSuite() {
	test("mutates comparisons, logic, arithmetic and constants, never strings or comments", function operators() {
		const mutants = generateMutants('if (a >= 1 && b) return a * 2; // a < b\nconst s = "x === y";\n', { python: false });

		expect(
			mutants.map(function describe(mutant: { operator: string; replacement: string }) {
				return `${mutant.operator}:${mutant.replacement}`;
			}),
		).toEqual(["boundary:>", "constant:2", "logical:||", "arithmetic:/", "constant:3"]);
	});

	test("leaves generics, arrows and imports alone", function safe() {
		expect(generateMutants('import { x } from "./y";\nconst m = new Map<string, number>();\nconst f = (a) => a;\n', { python: false })).toEqual(
			[],
		);
	});

	test("uses Python keywords for Python", function python() {
		expect(
			generateMutants("if total >= 100 and not member:\n    return True\n", { python: true }).map(function describe(mutant: {
				operator: string;
			}) {
				return mutant.operator;
			}),
		).toEqual(["boundary", "constant", "logical", "negation", "boolean"]);
	});

	test("respects a line range", function lines() {
		expect(generateMutants("a = 1;\nb = 2;\nc = 3;\n", { python: false, lines: [2, 2] })).toHaveLength(1);
	});
});

describe("helpers", function helpers() {
	test("applyMutant replaces exactly the matched text", function applies() {
		expect(applyMutant("a >= b", { offset: 2, length: 2, replacement: ">" })).toBe("a > b");
	});

	test("sample spreads a capped selection over the list", function samples() {
		expect(sample([1, 2, 3, 4, 5, 6], 3)).toEqual([1, 3, 5]);
	});

	test("mask keeps length and line breaks", function masks() {
		const source = 'x = "a && b" # c || d\ny = 1';

		expect(mask(source, true)).toHaveLength(source.length);
		expect(mask(source, true)).not.toMatch(/&&|\|\|/u);
	});

	test("parseArgs requires a file and a command", function args() {
		expect(parseArgs(["--file", "a.js", "--lines", "3-9", "--", "npm", "test"])).toMatchObject({
			file: "a.js",
			lines: [3, 9],
			command: ["npm", "test"],
		});
		expect(function missing() {
			parseArgs(["--file", "a.js"]);
		}).toThrow();
	});
});

describe("the mutation script", function script() {
	test("a happy-path test lets boundary and logic mutants survive", function weak() {
		const report = mutate(fixture("assert.equal(discount(200, true), 180);"));

		expect(report.score).toBeLessThan(100);
		expect(
			report.survived.map(function describe(mutant) {
				return mutant.operator;
			}),
		).toEqual(expect.arrayContaining(["boundary", "logical"]));
	});

	test("boundary and member cases kill every mutant, and the source is restored", function strong() {
		const dir = fixture(
			[
				"assert.equal(discount(200, true), 180);",
				"assert.equal(discount(100, true), 90);",
				"assert.equal(discount(99, true), 99);",
				"assert.equal(discount(200, false), 200);",
			].join("\n"),
		);
		const report = mutate(dir);

		expect(report).toMatchObject({ score: 100, survived: [] });
		expect(fs.readFileSync(path.join(dir, "pricing.mjs"), "utf8")).toBe(pricing);
	});
});
