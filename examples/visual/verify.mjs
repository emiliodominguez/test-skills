#!/usr/bin/env node
// Proves the claims of the test-visual skill against examples/visual/page.html with Playwright Test:
//   (a) baselines recorded from the correct page catch a seeded 6px button shift, and a loose
//       maxDiffPixelRatio accepts the same bug;
//   (b) an unmasked live clock and random promotion fail an unchanged page, a running CSS animation
//       never yields a stable baseline, and the controlled version passes repeatedly;
//   (c) the correct page passes every deterministic check.
// Baselines are recorded at verify time into a temporary directory that is removed afterwards, so
// no PNG files or test-results folders are committed or left in the repository. Prints one line
// per check and exits 0 only when every claim holds. Set CHROME when Chromium is elsewhere.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const config = "examples/visual/playwright.config.mjs";
const out = mkdtempSync(join(tmpdir(), "test-skills-visual-"));
const repeats = 5;
let failures = 0;

/**
 * @typedef {object} Outcome
 * @property {string} title - Test title, tags included.
 * @property {string} status - Playwright result status: passed, failed, timedOut, skipped or interrupted.
 * @property {string} message - First error message without ANSI escapes, or an empty string.
 */

/**
 * Run the visual project once through the Playwright CLI and collect one outcome per test run.
 *
 * @param {object} options - What to run.
 * @param {string} options.grep - Title pattern selecting the tests (tags such as `@stable`).
 * @param {"correct" | "buggy"} options.variant - Page variant served to the tests.
 * @param {string[]} [options.extra] - Additional CLI arguments, such as `--update-snapshots=all`.
 * @returns {Outcome[]} Outcomes in report order; empty when the report could not be parsed.
 */
function runPlaywright({ grep, variant, extra = [] }) {
	const result = spawnSync("npx", ["playwright", "test", "-c", config, "--reporter=json", "--grep", grep, ...extra], {
		cwd: root,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
		env: { ...process.env, VISUAL_OUT: out, VISUAL_VARIANT: variant, FORCE_COLOR: "0" },
	});

	try {
		return collectOutcomes(JSON.parse(result.stdout));
	} catch {
		console.error(result.stderr || result.stdout);
		return [];
	}
}

/**
 * Flatten a Playwright JSON report into one outcome per test result, repeats included.
 *
 * @param {any} report - Parsed output of the JSON reporter.
 * @returns {Outcome[]} Outcomes in report order.
 */
function collectOutcomes(report) {
	/** @type {Outcome[]} */
	const outcomes = [];

	/**
	 * Walk a suite and its nested suites, appending every result.
	 *
	 * @param {any} suite - A suite node from the report.
	 * @returns {void}
	 */
	function visit(suite) {
		for (const spec of suite.specs ?? []) {
			for (const test of spec.tests ?? []) {
				for (const result of test.results ?? []) {
					outcomes.push({ title: spec.title, status: result.status, message: stripAnsi(result.error?.message ?? "") });
				}
			}
		}

		for (const child of suite.suites ?? []) visit(child);
	}

	for (const suite of report.suites ?? []) visit(suite);

	return outcomes;
}

/**
 * Remove ANSI color escapes from a message.
 *
 * @param {string} text - Text that may contain escapes.
 * @returns {string} The plain text.
 */
function stripAnsi(text) {
	return text.replace(/\u001b\[[0-9;]*m/g, "");
}

/**
 * Count outcomes with a given status.
 *
 * @param {Outcome[]} outcomes - Collected outcomes.
 * @param {string} status - Status to count.
 * @returns {number} How many outcomes have that status.
 */
function count(outcomes, status) {
	return outcomes.filter(function hasStatus(outcome) {
		return outcome.status === status;
	}).length;
}

/**
 * The differing-pixel count reported in a screenshot comparison failure.
 *
 * @param {Outcome | undefined} outcome - A failed outcome.
 * @returns {string} Such as "625 pixels (ratio 0.02)", or "no pixel count" when absent.
 */
function pixelSummary(outcome) {
	const match = /(\d+) pixels \(ratio ([\d.]+)/.exec(outcome?.message ?? "");

	return match ? `${match[1]} pixels (ratio ${match[2]})` : "no pixel count";
}

/**
 * Print one check line and record a failure when the claim does not hold.
 *
 * @param {boolean} holds - Whether the claim holds.
 * @param {string} claim - The claim, stated as observed.
 * @returns {void}
 */
function check(holds, claim) {
	console.log(`${holds ? "ok  " : "FAIL"}  ${claim}`);
	if (!holds) failures += 1;
}

try {
	// Initial recording of baselines from the correct page. In a real suite this happens once, and
	// every later update goes through a reviewed diff, never a blind --update-snapshots.
	const recorded = runPlaywright({ grep: "@stable|@unstable", variant: "correct", extra: ["--update-snapshots=all"] });
	const baselines = ["plan-card.png", "status-controlled.png", "status-uncontrolled.png"].filter(function exists(name) {
		return existsSync(join(out, "baselines", "visual.spec.mjs", name));
	});

	check(
		recorded.length === 3 && count(recorded, "passed") === 3 && baselines.length === 3,
		`baselines recorded from the correct page: ${baselines.join(", ")}`,
	);

	const stable = runPlaywright({ grep: "@stable", variant: "correct", extra: [`--repeat-each=${repeats}`] });

	check(
		stable.length === 2 * repeats && count(stable, "passed") === 2 * repeats,
		`(c) correct page passes the card and the controlled status page: ${count(stable, "passed")}/${stable.length} runs`,
	);

	const strict = runPlaywright({ grep: "plan card @stable", variant: "buggy" });

	check(
		strict.length === 1 && strict[0]?.status === "failed" && /pixels \(ratio/.test(strict[0].message),
		`(a) seeded 6px button shift fails the card comparison: ${pixelSummary(strict[0])} differ`,
	);

	const loose = runPlaywright({ grep: "@loose", variant: "buggy" });

	check(loose.length === 1 && loose[0]?.status === "passed", "(a) the same bug passes with maxDiffPixelRatio 0.05: a loose threshold misses it");

	const unstable = runPlaywright({ grep: "@unstable", variant: "correct", extra: [`--repeat-each=${repeats}`] });
	const unstableFailed = count(unstable, "failed");

	check(
		unstable.length === repeats && unstableFailed >= 1,
		`(b) unmasked clock and random promotion on an unchanged page: ${unstableFailed}/${repeats} runs fail (${unstable
			.filter(function failed(outcome) {
				return outcome.status === "failed";
			})
			.map(pixelSummary)
			.join("; ")})`,
	);

	const animated = runPlaywright({ grep: "@animated", variant: "correct", extra: ["--update-snapshots=all"] });

	check(
		animated.length === 1 && animated[0]?.status === "failed" && /Timeout/.test(animated[0].message),
		"(b) running CSS animation: no two consecutive screenshots match, so no baseline can be recorded",
	);

	const controlled = stable.filter(function isControlled(outcome) {
		return outcome.title.startsWith("status page");
	});

	check(
		controlled.length === repeats && count(controlled, "passed") === repeats,
		`(b) fixed clock, masked promotion and disabled animations: ${count(controlled, "passed")}/${repeats} runs pass`,
	);
} finally {
	rmSync(out, { recursive: true, force: true });
}

process.exitCode = failures > 0 ? 1 : 0;
