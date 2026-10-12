#!/usr/bin/env node
// Run a test command many times to measure flakiness, keep the output of failing runs, and
// optionally run copies in parallel to surface timing and shared-state races. Zero dependencies.
//
//   node repeat.mjs --runs 50 -- npx vitest run src/cart.test.ts
//   node repeat.mjs --runs 200 --until-fail -- pytest tests/test_cart.py -x
//   node repeat.mjs --runs 30 --parallel 4 -- npx playwright test checkout.spec.ts
//
// Each run gets REPEAT_RUN=<n> and REPEAT_SEED=<n> in its environment, for suites that read a seed.
// Exit codes: 0 every run passed, 1 at least one run failed, 2 usage error.

import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Parse arguments.
 *
 * @param {string[]} argv - Arguments after the script path.
 * @returns {{ runs: number, parallel: number, untilFail: boolean, out: string, command: string[] }} Options.
 */
export function parseArgs(argv) {
	const separator = argv.indexOf("--");

	if (separator === -1 || separator === argv.length - 1) throw new Error("usage: repeat.mjs [--runs n] [--parallel k] [--until-fail] [--out dir] -- <command...>");

	const own = argv.slice(0, separator);
	const value = function read(name, fallback) {
		const index = own.indexOf(name);

		return index === -1 ? fallback : own[index + 1];
	};
	const runs = Number(value("--runs", "20"));
	const parallel = Number(value("--parallel", "1"));

	if (!Number.isInteger(runs) || runs < 1 || !Number.isInteger(parallel) || parallel < 1) throw new Error("--runs and --parallel must be positive integers");

	return { runs, parallel, untilFail: own.includes("--until-fail"), out: value("--out", join("out", "repeat")), command: argv.slice(separator + 1) };
}

/**
 * Summarize run results.
 *
 * @param {Array<{ run: number, code: number, ms: number }>} results - Finished runs.
 * @returns {{ runs: number, failures: number, rate: number, p50: number, max: number, failedRuns: number[] }} Summary.
 */
export function summarize(results) {
	const durations = results
		.map(function duration(result) {
			return result.ms;
		})
		.sort(function ascending(a, b) {
			return a - b;
		});
	const failed = results.filter(function isFailure(result) {
		return result.code !== 0;
	});

	return {
		runs: results.length,
		failures: failed.length,
		rate: results.length === 0 ? 0 : failed.length / results.length,
		p50: durations[Math.floor(durations.length / 2)] ?? 0,
		max: durations.at(-1) ?? 0,
		failedRuns: failed
			.map(function runOf(result) {
				return result.run;
			})
			.sort(function ascending(a, b) {
				return a - b;
			}),
	};
}

/**
 * Create a folder and return it, or null when it cannot be written.
 *
 * @param {string} folder - Folder to create.
 * @returns {string | null} The folder, or null.
 */
function writableFolder(folder) {
	try {
		mkdirSync(folder, { recursive: true });
		writeFileSync(join(folder, ".write-probe"), "");
		rmSync(join(folder, ".write-probe"));

		return folder;
	} catch {
		return null;
	}
}

/**
 * Run the command once.
 *
 * @param {string[]} command - Command and arguments.
 * @param {number} run - Run number.
 * @returns {Promise<{ run: number, code: number, ms: number, output: string }>} Result.
 */
function runOnce(command, run) {
	return new Promise(function execute(done) {
		const started = Date.now();
		const child = spawn(command[0], command.slice(1), { env: { ...process.env, REPEAT_RUN: String(run), REPEAT_SEED: String(run) }, shell: process.platform === "win32" });
		let output = "";

		child.stdout.on("data", function collect(chunk) {
			output += chunk;
		});
		child.stderr.on("data", function collect(chunk) {
			output += chunk;
		});
		child.on("error", function failed(error) {
			done({ run, code: 127, ms: Date.now() - started, output: String(error) });
		});
		child.on("close", function closed(code) {
			done({ run, code: code ?? 1, ms: Date.now() - started, output });
		});
	});
}

/**
 * Entry point.
 *
 * @param {string[]} argv - Arguments after the script path.
 * @returns {Promise<number>} Exit code.
 */
async function main(argv) {
	let options;

	try {
		options = parseArgs(argv);
	} catch (error) {
		console.error(String(error instanceof Error ? error.message : error));
		return 2;
	}

	const results = [];
	const failedOutput = [];
	let next = 1;
	let stop = false;

	// A read-only workspace (for example a sandbox) still allows measuring: fall back to the temp
	// folder, and when nothing is writable print the failing output instead of saving it.
	const out = writableFolder(options.out) ?? writableFolder(join(tmpdir(), "repeat"));

	if (out !== options.out) console.error(out ? `Cannot write ${options.out}; writing logs to ${out}` : "No writable folder: failing output is printed instead of saved.");

	/**
	 * Keep one lane busy until the runs are used up or a failure stops the batch.
	 */
	async function lane() {
		while (!stop && next <= options.runs) {
			const run = next;

			next += 1;

			const result = await runOnce(options.command, run);

			results.push(result);
			process.stdout.write(result.code === 0 ? "." : "F");

			if (result.code !== 0) {
				if (out) writeFileSync(join(out, `run-${run}.log`), result.output);
				else failedOutput.push(`--- run ${run} (exit ${result.code}) ---\n${result.output.split("\n").slice(-20).join("\n")}`);
				if (options.untilFail) stop = true;
			}
		}
	}

	await Promise.all(Array.from({ length: options.parallel }, lane));

	const summary = summarize(results);

	console.log(
		`\n${summary.failures}/${summary.runs} runs failed (${(summary.rate * 100).toFixed(1)}%), p50 ${summary.p50} ms, max ${summary.max} ms` +
			(summary.failures > 0 ? `\nfailing runs: ${summary.failedRuns.join(", ")}${out ? `; logs in ${out}/run-<n>.log` : ""}` : ""),
	);
	if (out) writeFileSync(join(out, "summary.json"), `${JSON.stringify({ command: options.command, parallel: options.parallel, ...summary }, null, "\t")}\n`);
	for (const block of failedOutput) console.log(block);

	return summary.failures > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	main(process.argv.slice(2)).then(function finish(code) {
		process.exitCode = code;
	});
}
