#!/usr/bin/env node
// Score test suites written for an evaluation fixture: test count, audit findings, mock usage and
// mutation score, one row per directory. Each directory holds the module and its test file.
//
//   node evals/score-suites.mjs [--module pricing.mjs] [--tests pricing.test.mjs] <dir>...
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const audit = join(root, "skills/test-audit/scripts/audit-tests.mjs");
const mutate = join(root, "skills/test-audit/scripts/mutate.mjs");

const argv = process.argv.slice(2);
const option = function read(name, fallback) {
	const index = argv.indexOf(name);

	return index === -1 ? fallback : argv[index + 1];
};
const moduleFile = option("--module", "pricing.mjs");
const testFile = option("--tests", moduleFile.replace(/\.mjs$/u, ".test.mjs"));
const directories = argv.filter(function isDirectory(argument, index) {
	return !argument.startsWith("--") && !["--module", "--tests"].includes(argv[index - 1]);
});

/**
 * Score one suite.
 *
 * @param {string} directory - Directory with the module and its tests.
 * @returns {{ arm: string, tests: number, auditFindings: number, mocks: number, mutants: number, score: number, survived: string[] }} Scores.
 */
function score(directory) {
	const run = spawnSync("node", ["--test", testFile], { cwd: directory, encoding: "utf8" });
	const tests = Number(/# tests (\d+)/u.exec(run.stdout)?.[1] ?? 0);
	const findings = JSON.parse(spawnSync("node", [audit, "--json", testFile], { cwd: directory, encoding: "utf8" }).stdout).findings.length;
	const source = readFileSync(join(directory, testFile), "utf8");
	const mocks = [...source.matchAll(/\bmock\.(?:fn|method|module|timers)\b|\bt\.mock\b|\b(?:vi|jest|sinon)\.(?:fn|spyOn|stub|mock)\b/gu)].length;
	const report = JSON.parse(
		execFileSync("node", [mutate, "--file", moduleFile, "--json", "--", "node", "--test", testFile], { cwd: directory, encoding: "utf8" }),
	);

	return {
		arm: basename(directory),
		tests,
		auditFindings: findings,
		mocks,
		mutants: report.mutants,
		score: report.score,
		survived: report.survived.map(function describe(mutant) {
			return `${mutant.line}:${mutant.operator}->${mutant.replacement || "(removed)"}`;
		}),
	};
}

const rows = directories.map(function scoreOne(directory) {
	return score(resolve(directory));
});

console.log("| Suite | Tests | Audit findings | Mock calls | Mutants | Mutation score | Surviving mutants |");
console.log("| --- | ---: | ---: | ---: | ---: | ---: | --- |");

for (const row of rows)
	console.log(
		`| ${row.arm} | ${row.tests} | ${row.auditFindings} | ${row.mocks} | ${row.mutants} | ${row.score}% | ${row.survived.join(", ") || "none"} |`,
	);
