// A small offline evaluation harness for the triage feature in `triage.mjs`: a golden dataset
// (`golden.jsonl`), per-case assertions, multiple samples per case, a per-case comparison against
// a baseline with a flip report, and a gate that fails on any case that went from pass to fail.
// The "model" is a deterministic stub whose variant simulates a prompt change, so the harness runs
// with no network and no API key. Swap `createStub` for a real model call to run it for real.
//
//   node examples/llm/eval.mjs --baseline baseline --candidate regressed
//   node examples/llm/eval.mjs --baseline baseline --candidate baseline --temperature 0.6 --candidate-seed 2
//   node examples/llm/eval.mjs --baseline baseline --candidate baseline --temperature 0.6 --candidate-seed 2 --samples 25 --threshold 0.5

import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseTriage } from "./triage.mjs";

/** Path of the golden dataset next to this file. */
export const GOLDEN_PATH = fileURLToPath(new URL("./golden.jsonl", import.meta.url));

/**
 * @typedef {{ type: "schema" }
 *   | { type: "equals", path: string, value: unknown }
 *   | { type: "contains", path: string, value: string }
 *   | { type: "regex", path: string, pattern: string, flags?: string }
 *   | { type: "numeric", path: string, value: number, tolerance: number }
 *   | { type: "absent", path: string }} Assertion
 */

/**
 * @typedef {object} EvalCase
 * @property {string} id - Stable case id; comparisons join on it.
 * @property {string} source - Where the case came from.
 * @property {string[]} tags - Slices for reporting.
 * @property {{ id: string, subject: string, body: string, locale: string, name: string }} input - Ticket fields.
 * @property {Assertion[]} expect - Every assertion must hold for the case to pass.
 */

/**
 * Load a JSONL dataset.
 *
 * @param {string} [file] - Path to the file; defaults to the golden set.
 * @returns {EvalCase[]} The cases, in file order.
 */
export function loadCases(file = GOLDEN_PATH) {
	return fs
		.readFileSync(file, "utf8")
		.split("\n")
		.filter(function nonEmpty(line) {
			return line.trim() !== "";
		})
		.map(function parseLine(line) {
			return JSON.parse(line);
		});
}

/**
 * A small seeded generator (mulberry32) so sampled runs replay exactly.
 *
 * @param {number} seed - 32-bit seed.
 * @returns {() => number} A function returning floats in [0, 1).
 */
export function seededRandom(seed) {
	let state = seed >>> 0;

	return function next() {
		state = (state + 0x6d2b79f5) >>> 0;

		let value = state;

		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
}

/** Keyword rules standing in for what a prompt teaches the model. */
const RULES = {
	billing: /refund|charg|invoice|payment|paying/iu,
	bug: /crash|error|broken|bug|freez/iu,
	account: /password|log ?in|2fa|sign[- ]in/iu,
};

/** Rule order per variant: the "regressed" prompt tells the model to put account security first. */
const VARIANTS = {
	baseline: ["billing", "bug", "account"],
	regressed: ["account", "billing", "bug"],
};

/** Greeting per language, as the prompt asks the reply to open. */
const GREETINGS = { es: "Hola", pt: "Olá", fr: "Bonjour" };

/**
 * A deterministic stand-in for a model: same input, settings and seed give the same text.
 * With `temperature > 0`, ambiguous tickets sometimes get their second-best category.
 *
 * @param {keyof typeof VARIANTS} variant - Simulated prompt or model version.
 * @param {{ temperature?: number, seed?: number }} [settings] - Sampling settings.
 * @returns {(input: EvalCase["input"]) => Promise<string>} A generate function returning JSON text.
 */
export function createStub(variant, settings = {}) {
	const temperature = settings.temperature ?? 0;
	const random = seededRandom(settings.seed ?? 1);
	const order = VARIANTS[variant];

	if (!order) throw new Error(`unknown variant ${variant}`);

	return async function generate(input) {
		const text = `${input.subject}\n${input.body}`;
		const matches = order.filter(function matchesRule(category) {
			return RULES[/** @type {keyof typeof RULES} */ (category)].test(text);
		});
		const pick = matches.length > 1 && random() < temperature / 2 ? 1 : 0;
		const category = matches[pick] ?? "other";
		const priority = /twice|urgent|cannot|can't|locked/iu.test(text) ? "high" : /question|wondering|curious/iu.test(text) ? "low" : "normal";
		const greeting = GREETINGS[/** @type {keyof typeof GREETINGS} */ (input.locale.split("-")[0])] ?? "Hi";
		const amount = /\$(\d+)\.(\d{2})/u.exec(text);
		/** @type {Record<string, unknown>} */
		const output = { category, priority, reply: `${greeting} ${input.name}, we are looking into ticket ${input.id}.` };

		if (category === "billing" && amount) output.refundCents = Number(amount[1]) * 100 + Number(amount[2]);

		return JSON.stringify(output);
	};
}

/**
 * Read a top-level field from a parsed output.
 *
 * @param {unknown} value - Parsed output.
 * @param {string} path - Field name.
 * @returns {unknown} The field value, or undefined.
 */
function field(value, path) {
	return value && typeof value === "object" ? /** @type {Record<string, unknown>} */ (value)[path] : undefined;
}

/**
 * Check one assertion against a parsed output.
 *
 * @param {import("./triage.mjs").ParsedTriage} parsed - Output after the production parser.
 * @param {Assertion} assertion - The assertion.
 * @returns {string | undefined} A failure message, or undefined when it holds.
 */
export function checkAssertion(parsed, assertion) {
	if (!parsed.ok) return `${assertion.type}: unparseable output (${parsed.kind}: ${parsed.issues.join("; ")})`;
	if (assertion.type === "schema") return undefined;

	const actual = field(parsed.value, assertion.path);

	switch (assertion.type) {
		case "equals":
			return actual === assertion.value
				? undefined
				: `${assertion.path}: expected ${JSON.stringify(assertion.value)}, got ${JSON.stringify(actual)}`;
		case "contains":
			return typeof actual === "string" && actual.includes(assertion.value)
				? undefined
				: `${assertion.path}: missing ${JSON.stringify(assertion.value)}`;
		case "regex":
			return typeof actual === "string" && new RegExp(assertion.pattern, assertion.flags ?? "u").test(actual)
				? undefined
				: `${assertion.path}: does not match /${assertion.pattern}/`;
		case "numeric":
			return typeof actual === "number" && Math.abs(actual - assertion.value) <= assertion.tolerance
				? undefined
				: `${assertion.path}: expected ${assertion.value} +/- ${assertion.tolerance}, got ${JSON.stringify(actual)}`;
		case "absent":
			return actual === undefined ? undefined : `${assertion.path}: expected absent, got ${JSON.stringify(actual)}`;
		default:
			return `unknown assertion ${JSON.stringify(assertion)}`;
	}
}

/**
 * @typedef {object} CaseResult
 * @property {string} id - Case id.
 * @property {number} passes - Samples where every assertion held.
 * @property {number} samples - Samples drawn.
 * @property {string[]} failures - Distinct failure messages across samples.
 */

/**
 * Run every case `samples` times through a generate function and the production parser.
 *
 * @param {EvalCase[]} cases - The dataset.
 * @param {(input: EvalCase["input"]) => Promise<string>} generate - The model under test.
 * @param {{ samples?: number }} [options] - Samples per case.
 * @returns {Promise<CaseResult[]>} One result per case.
 */
export async function runSuite(cases, generate, options = {}) {
	const samples = options.samples ?? 1;
	const results = [];

	for (const testCase of cases) {
		const failures = new Set();
		let passes = 0;

		for (let sample = 0; sample < samples; sample += 1) {
			const parsed = parseTriage(await generate(testCase.input), { fixed: true });
			const failed = testCase.expect
				.map(function check(assertion) {
					return checkAssertion(parsed, assertion);
				})
				.filter(function isFailure(message) {
					return message !== undefined;
				});

			if (failed.length === 0) passes += 1;

			for (const message of failed) failures.add(message);
		}

		results.push({ id: testCase.id, passes, samples, failures: [...failures] });
	}

	return results;
}

/**
 * Wilson score interval for a pass rate.
 *
 * @param {number} successes - Passing cases.
 * @param {number} total - All cases.
 * @param {number} [z] - Normal quantile; 1.96 for 95%.
 * @returns {[number, number]} Lower and upper bounds.
 */
export function wilsonInterval(successes, total, z = 1.96) {
	if (total === 0) return [0, 1];

	const rate = successes / total;
	const denominator = 1 + (z * z) / total;
	const centre = (rate + (z * z) / (2 * total)) / denominator;
	const margin = (z * Math.sqrt((rate * (1 - rate)) / total + (z * z) / (4 * total * total))) / denominator;

	return [Math.max(0, centre - margin), Math.min(1, centre + margin)];
}

/**
 * Exact two-sided McNemar test on discordant pairs: is "pass to fail" more common than "fail to pass"?
 *
 * @param {number} regressions - Cases that went from pass to fail.
 * @param {number} fixes - Cases that went from fail to pass.
 * @returns {number} Two-sided p-value; 1 when there are no discordant pairs.
 */
export function mcnemarExact(regressions, fixes) {
	const n = regressions + fixes;

	if (n === 0) return 1;

	const k = Math.min(regressions, fixes);
	let tail = 0;
	let coefficient = 1;

	for (let i = 0; i <= k; i += 1) {
		if (i > 0) coefficient = (coefficient * (n - i + 1)) / i;
		tail += coefficient / 2 ** n;
	}

	return Math.min(1, 2 * tail);
}

/**
 * @typedef {object} Comparison
 * @property {Array<{ id: string, baseline: CaseResult, candidate: CaseResult, flip: "regressed" | "fixed" | null }>} cases - Per-case pairs.
 * @property {string[]} regressions - Ids that went from pass to fail.
 * @property {string[]} fixes - Ids that went from fail to pass.
 * @property {string[]} stableFailures - Ids failing in both.
 * @property {{ passed: number, total: number, rate: number, interval: [number, number] }} baseline - Aggregate.
 * @property {{ passed: number, total: number, rate: number, interval: [number, number] }} candidate - Aggregate.
 * @property {number} pValue - Exact McNemar p-value on the flips.
 * @property {{ ok: boolean, reasons: string[] }} gate - Release decision.
 */

/**
 * Compare a candidate run with a baseline run case by case.
 *
 * @param {CaseResult[]} baseline - Baseline results.
 * @param {CaseResult[]} candidate - Candidate results.
 * @param {{ passThreshold?: number, acceptedRegressions?: Record<string, string> }} [options] - Share of samples a case needs to pass (1 means every sample), and reviewed regressions with a reason.
 * @returns {Comparison} The comparison and gate.
 */
export function compareRuns(baseline, candidate, options = {}) {
	const threshold = options.passThreshold ?? 1;
	const accepted = options.acceptedRegressions ?? {};
	const byId = new Map(
		candidate.map(function entry(result) {
			return [result.id, result];
		}),
	);

	/**
	 * Whether a case result passes at the threshold.
	 *
	 * @param {CaseResult} result - A case result.
	 * @returns {boolean} True when it passes.
	 */
	function passed(result) {
		return result.passes / result.samples >= threshold;
	}

	const cases = baseline.map(function pair(base) {
		const next = byId.get(base.id);

		if (!next) throw new Error(`case ${base.id} missing from the candidate run`);

		const flip = passed(base) && !passed(next) ? "regressed" : !passed(base) && passed(next) ? "fixed" : null;

		return { id: base.id, baseline: base, candidate: next, flip: /** @type {"regressed" | "fixed" | null} */ (flip) };
	});

	/**
	 * Ids of pairs matching a predicate.
	 *
	 * @param {(pair: (typeof cases)[number]) => boolean} predicate - Filter.
	 * @returns {string[]} Matching ids.
	 */
	function ids(predicate) {
		return cases.filter(predicate).map(function toId(pair) {
			return pair.id;
		});
	}

	/**
	 * Aggregate pass rate with a 95% interval.
	 *
	 * @param {CaseResult[]} results - Case results.
	 * @returns {{ passed: number, total: number, rate: number, interval: [number, number] }} The aggregate.
	 */
	function aggregate(results) {
		const count = results.filter(passed).length;

		return { passed: count, total: results.length, rate: count / results.length, interval: wilsonInterval(count, results.length) };
	}

	const regressions = ids(function isRegression(pair) {
		return pair.flip === "regressed";
	});
	const fixes = ids(function isFix(pair) {
		return pair.flip === "fixed";
	});
	const unreviewed = regressions.filter(function notAccepted(id) {
		return !(id in accepted);
	});

	return {
		cases,
		regressions,
		fixes,
		stableFailures: ids(function bothFail(pair) {
			return !passed(pair.baseline) && !passed(pair.candidate);
		}),
		baseline: aggregate(baseline),
		candidate: aggregate(candidate),
		pValue: mcnemarExact(regressions.length, fixes.length),
		gate: {
			ok: unreviewed.length === 0,
			reasons: unreviewed.map(function reason(id) {
				return `${id} regressed and is not in acceptedRegressions`;
			}),
		},
	};
}

/**
 * Render a comparison as plain text for a terminal or a pull request comment.
 *
 * @param {Comparison} comparison - The comparison.
 * @returns {string} The report.
 */
export function formatReport(comparison) {
	/**
	 * Format a rate and interval.
	 *
	 * @param {Comparison["baseline"]} summary - Aggregate.
	 * @returns {string} Text such as "16/20 (80.0%, 95% CI 58.4-91.9%)".
	 */
	function rate(summary) {
		const [low, high] = summary.interval;

		return `${summary.passed}/${summary.total} (${(summary.rate * 100).toFixed(1)}%, 95% CI ${(low * 100).toFixed(1)}-${(high * 100).toFixed(1)}%)`;
	}

	const lines = [`baseline   ${rate(comparison.baseline)}`, `candidate  ${rate(comparison.candidate)}`, ""];

	for (const pair of comparison.cases) {
		if (!pair.flip) continue;

		const detail = pair.flip === "regressed" ? pair.candidate.failures.join("; ") : "now passes";

		lines.push(`${pair.flip === "regressed" ? "PASS -> FAIL" : "FAIL -> PASS"}  ${pair.id}  ${detail}`);
	}

	lines.push(
		"",
		`flips: ${comparison.regressions.length} regressed, ${comparison.fixes.length} fixed, exact McNemar p=${comparison.pValue.toFixed(3)}`,
		`stable failures: ${comparison.stableFailures.join(", ") || "none"}`,
		`gate: ${comparison.gate.ok ? "pass" : `FAIL - ${comparison.gate.reasons.join("; ")}`}`,
	);

	return lines.join("\n");
}

/**
 * Read `--name value` pairs from argv.
 *
 * @param {string[]} argv - Arguments after the script path.
 * @returns {Record<string, string>} Parsed flags.
 */
function parseFlags(argv) {
	/** @type {Record<string, string>} */
	const flags = {};

	for (let index = 0; index < argv.length; index += 2) flags[argv[index].replace(/^--/u, "")] = argv[index + 1] ?? "";

	return flags;
}

/**
 * Command line entry: run baseline and candidate stubs, print the report, exit 1 when the gate fails.
 *
 * @returns {Promise<void>} Resolves when done.
 */
async function main() {
	const flags = parseFlags(process.argv.slice(2));
	const cases = loadCases(flags.dataset || GOLDEN_PATH);
	const temperature = Number(flags.temperature ?? 0);
	const samples = Number(flags.samples ?? 1);
	const baseline = await runSuite(
		cases,
		createStub(/** @type {any} */ (flags.baseline ?? "baseline"), { temperature, seed: Number(flags.seed ?? 1) }),
		{ samples },
	);
	const candidate = await runSuite(
		cases,
		createStub(/** @type {any} */ (flags.candidate ?? "regressed"), { temperature, seed: Number(flags["candidate-seed"] ?? flags.seed ?? 1) }),
		{ samples },
	);
	const comparison = compareRuns(baseline, candidate, { passThreshold: Number(flags.threshold ?? 1) });

	process.stdout.write(`${formatReport(comparison)}\n`);
	process.exitCode = comparison.gate.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
