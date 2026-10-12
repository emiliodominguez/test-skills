import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { parseArgs, summarize } from "../skills/test-flaky/scripts/repeat.mjs";

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../skills/test-flaky/scripts/repeat.mjs");
const temporary: string[] = [];

/**
 * A fresh temporary folder, removed after each test.
 *
 * @returns Folder path.
 */
function folder(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repeat-"));

	temporary.push(dir);

	return dir;
}

/**
 * Run the repeat CLI.
 *
 * @param args - CLI arguments.
 * @param cwd - Working directory.
 * @param env - Extra environment variables.
 * @returns Exit status and output.
 */
function run(args: string[], cwd: string, env: Record<string, string> = {}): { status: number | null; stdout: string; stderr: string } {
	const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8", env: { ...process.env, ...env } });

	return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/**
 * A node one-liner as a command, so the tests do not depend on a shell.
 *
 * @param code - JavaScript to evaluate.
 * @returns Command and arguments.
 */
function nodeCommand(code: string): string[] {
	return [process.execPath, "-e", code];
}

afterEach(function cleanUp() {
	for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("parseArgs", function parseArgsSuite() {
	test("defaults", function defaults() {
		expect(parseArgs(["--", "npm", "test"])).toEqual({
			runs: 20,
			parallel: 1,
			untilFail: false,
			out: path.join("out", "repeat"),
			command: ["npm", "test"],
		});
	});

	test("reads every option", function options() {
		expect(parseArgs(["--runs", "7", "--parallel", "3", "--until-fail", "--out", "logs", "--", "pytest", "-x"])).toEqual({
			runs: 7,
			parallel: 3,
			untilFail: true,
			out: "logs",
			command: ["pytest", "-x"],
		});
	});

	test("options after the separator belong to the command", function separator() {
		expect(parseArgs(["--", "cmd", "--runs", "3"])).toMatchObject({ runs: 20, command: ["cmd", "--runs", "3"] });
	});

	test.each([[["npm", "test"]], [["--runs", "2", "--"]], [[]]])("rejects a missing command: %j", function missing(argv) {
		expect(function parse() {
			return parseArgs(argv);
		}).toThrow(/usage/u);
	});

	test.each(["0", "-1", "1.5", "x"])("rejects --runs %s", function badRuns(value) {
		expect(function parse() {
			return parseArgs(["--runs", value, "--", "cmd"]);
		}).toThrow(/positive integers/u);
	});

	test.each(["0", "2.5"])("rejects --parallel %s", function badParallel(value) {
		expect(function parse() {
			return parseArgs(["--parallel", value, "--", "cmd"]);
		}).toThrow(/positive integers/u);
	});

	test("accepts one run and one lane", function minimum() {
		expect(parseArgs(["--runs", "1", "--parallel", "1", "--", "cmd"])).toMatchObject({ runs: 1, parallel: 1 });
	});
});

describe("summarize", function summarizeSuite() {
	test("empty", function empty() {
		expect(summarize([])).toEqual({ runs: 0, failures: 0, rate: 0, p50: 0, max: 0, failedRuns: [] });
	});

	test("rate, median, max and sorted failing runs", function stats() {
		const summary = summarize([
			{ run: 4, code: 1, ms: 40 },
			{ run: 1, code: 0, ms: 10 },
			{ run: 3, code: 2, ms: 30 },
			{ run: 2, code: 0, ms: 20 },
			{ run: 5, code: 0, ms: 50 },
		]);

		expect(summary).toEqual({ runs: 5, failures: 2, rate: 0.4, p50: 30, max: 50, failedRuns: [3, 4] });
	});

	test("sorts durations numerically, not as strings", function numeric() {
		expect(
			summarize([
				{ run: 1, code: 0, ms: 9 },
				{ run: 2, code: 0, ms: 100 },
				{ run: 3, code: 0, ms: 20 },
			]),
		).toMatchObject({ p50: 20, max: 100 });
	});

	test("sorts failing runs numerically", function failingOrder() {
		expect(
			summarize([
				{ run: 10, code: 1, ms: 1 },
				{ run: 9, code: 1, ms: 1 },
			]).failedRuns,
		).toEqual([9, 10]);
	});
});

describe("CLI", function cli() {
	test("all runs pass: exit 0 and a summary file", function passing() {
		const cwd = folder();
		const result = run(["--runs", "3", "--out", "logs", "--", ...nodeCommand("process.exit(0)")], cwd);

		expect(result.status).toBe(0);
		expect(result.stdout).toContain("...");
		expect(result.stdout).toContain("0/3 runs failed (0.0%)");
		expect(result.stdout).not.toContain("failing runs");

		const summary = JSON.parse(fs.readFileSync(path.join(cwd, "logs", "summary.json"), "utf8"));

		expect(summary).toMatchObject({ runs: 3, failures: 0, parallel: 1, failedRuns: [] });
		expect(summary.command[0]).toBe(process.execPath);
		expect(summary.max).toBeGreaterThan(0);
		expect(summary.max).toBeLessThan(60_000);
		expect(fs.existsSync(path.join(cwd, "logs", ".write-probe"))).toBe(false);
	});

	test("every run sees its number and seed", function environment() {
		const cwd = folder();
		const code = "require('fs').appendFileSync('seen.txt', process.env.REPEAT_RUN + ':' + process.env.REPEAT_SEED + '\\n')";

		expect(run(["--runs", "4", "--out", "logs", "--", ...nodeCommand(code)], cwd).status).toBe(0);
		expect(fs.readFileSync(path.join(cwd, "seen.txt"), "utf8").trim().split("\n").sort()).toEqual(["1:1", "2:2", "3:3", "4:4"]);
	});

	test("failing runs: exit 1, their logs kept, passing runs not logged", function failing() {
		const cwd = folder();
		const code =
			"const n = Number(process.env.REPEAT_RUN); console.log('stdout ' + n); console.error('stderr ' + n); process.exit(n % 2 === 0 ? 3 : 0)";
		const result = run(["--runs", "4", "--out", "logs", "--", ...nodeCommand(code)], cwd);

		expect(result.status).toBe(1);
		expect(result.stdout).toContain("2/4 runs failed (50.0%)");
		expect(result.stdout).toContain("failing runs: 2, 4; logs in logs/run-<n>.log");
		expect(fs.readFileSync(path.join(cwd, "logs", "run-2.log"), "utf8")).toBe("stdout 2\nstderr 2\n");
		expect(fs.existsSync(path.join(cwd, "logs", "run-1.log"))).toBe(false);
		expect(JSON.parse(fs.readFileSync(path.join(cwd, "logs", "summary.json"), "utf8"))).toMatchObject({ failures: 2, failedRuns: [2, 4] });
	});

	test("--until-fail stops at the first failure", function untilFail() {
		const cwd = folder();
		const result = run(
			["--runs", "10", "--until-fail", "--out", "logs", "--", ...nodeCommand("process.exit(process.env.REPEAT_RUN === '2' ? 1 : 0)")],
			cwd,
		);

		expect(result.status).toBe(1);
		expect(result.stdout).toContain("1/2 runs failed");
	});

	test("--parallel runs lanes concurrently and still runs each number once", function parallel() {
		const cwd = folder();
		const code = "require('fs').appendFileSync('seen.txt', process.env.REPEAT_RUN + '\\n'); setTimeout(function wait() {}, 300)";
		const started = Date.now();

		expect(run(["--runs", "4", "--parallel", "4", "--out", "logs", "--", ...nodeCommand(code)], cwd).status).toBe(0);
		expect(Date.now() - started).toBeLessThan(4 * 300 + 2000);
		expect(fs.readFileSync(path.join(cwd, "seen.txt"), "utf8").trim().split("\n").sort()).toEqual(["1", "2", "3", "4"]);
		expect(JSON.parse(fs.readFileSync(path.join(cwd, "logs", "summary.json"), "utf8"))).toMatchObject({ parallel: 4, runs: 4 });
	});

	test("a command that cannot start counts as a failure", function missingCommand() {
		const cwd = folder();
		const result = run(["--runs", "2", "--out", "logs", "--", "definitely-not-a-command-xyz"], cwd);

		expect(result.status).toBe(1);
		expect(result.stdout).toContain("2/2 runs failed");
		expect(result.stdout).toMatch(/max \d{1,4} ms/u);
		expect(fs.readFileSync(path.join(cwd, "logs", "run-1.log"), "utf8")).toContain("ENOENT");
	});

	test("usage errors exit 2", function usage() {
		const cwd = folder();

		expect(run(["--runs", "3"], cwd)).toMatchObject({ status: 2 });
		expect(run(["--runs", "0", "--", "cmd"], cwd).stderr).toContain("positive integers");
	});

	test("an unwritable --out falls back to the temp folder", function fallback() {
		const cwd = folder();

		fs.writeFileSync(path.join(cwd, "blocked"), "a file, not a folder");

		const result = run(["--runs", "1", "--out", path.join("blocked", "logs"), "--", ...nodeCommand("process.exit(1)")], cwd);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain(`Cannot write ${path.join("blocked", "logs")}; writing logs to ${path.join(os.tmpdir(), "repeat")}`);
		expect(result.stdout).toContain(`logs in ${path.join(os.tmpdir(), "repeat")}/run-<n>.log`);
	});

	test("nothing writable: the failing output is printed instead", function printed() {
		const cwd = folder();

		fs.writeFileSync(path.join(cwd, "blocked"), "a file, not a folder");

		const code = "for (let line = 1; line <= 30; line += 1) console.log('line ' + line); process.exit(4)";
		const result = run(["--runs", "1", "--out", path.join("blocked", "logs"), "--", ...nodeCommand(code)], cwd, {
			TMPDIR: path.join(cwd, "blocked"),
		});

		expect(result.status).toBe(1);
		expect(result.stderr).toContain("No writable folder: failing output is printed instead of saved.");
		expect(result.stdout).toContain("--- run 1 (exit 4) ---");
		expect(result.stdout).toContain("line 30");
		expect(result.stdout).not.toContain("line 10\n");
		expect(result.stdout).not.toContain("logs in");
	});
});
