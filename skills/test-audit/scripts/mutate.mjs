#!/usr/bin/env node
// Zero-dependency mutation testing for one source file: apply small faults one at a time (flip a
// comparison, swap && and ||, change a constant, drop a negation...), run the tests after each,
// and report the mutants no test noticed. The source file is always restored.
//
//   node mutate.mjs --file src/pricing.js -- npx vitest run src/pricing.test.js
//   node mutate.mjs --file app/pricing.py --lines 10-60 -- pytest tests/test_pricing.py -x -q
//   node mutate.mjs --file src/cart.ts --max 80 --json -- npm test
//
// Options:
//   --file <path>        Source file to mutate (JavaScript, TypeScript or Python)
//   --lines <a-b>        Only mutate these lines
//   --max <n>            Cap the number of mutants (default 200), spread evenly over the file
//   --timeout <ms>       Per-run timeout (default: 5x the baseline run, at least 10 s)
//   --min-score <0-100>  Exit 1 when the mutation score is below this (default: report only)
//   --json               Machine-readable output
//
// A mutant is killed when the test command fails or times out, and survives when it passes.
// Exit codes: 0 done (and score at or above --min-score), 1 score too low, 2 usage error or a
// baseline that does not pass.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Characters after which a slash starts a regular expression literal rather than a division. */
const REGEX_PRECEDERS = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^"]);

/** Keywords after which a slash starts a regular expression literal. */
const REGEX_KEYWORDS = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "yield", "await"]);

/**
 * End offset (exclusive, after any flags) of a regular expression literal starting at `start`,
 * or -1 when the slash is a division operator.
 *
 * @param {string} source - Source text.
 * @param {number} start - Offset of the opening slash.
 * @returns {number} End offset, or -1.
 */
export function regexLiteralEnd(source, start) {
	let before = start - 1;

	while (before >= 0 && /\s/u.test(source[before])) before -= 1;

	if (before >= 0) {
		const previous = source[before];

		if (/[\w$]/u.test(previous)) {
			let wordStart = before;

			while (wordStart > 0 && /[\w$]/u.test(source[wordStart - 1])) wordStart -= 1;
			if (!REGEX_KEYWORDS.has(source.slice(wordStart, before + 1))) return -1;
		} else if (!REGEX_PRECEDERS.has(previous)) {
			return -1;
		}
	}

	let inClass = false;

	for (let at = start + 1; at < source.length; at += 1) {
		const char = source[at];

		if (char === "\\") at += 1;
		else if (char === "\n") return -1;
		else if (char === "[") inClass = true;
		else if (char === "]") inClass = false;
		else if (char === "/" && !inClass) {
			let end = at + 1;

			while (end < source.length && /[a-z]/u.test(source[end])) end += 1;

			return end;
		}
	}

	return -1;
}

/**
 * Replace comment, string and regular expression contents with spaces, keeping offsets and line
 * breaks.
 *
 * @param {string} source - Source text.
 * @param {boolean} python - Whether to use Python comment and string rules.
 * @returns {string} Masked source of the same length.
 */
export function mask(source, python) {
	const out = source.split("");
	let index = 0;

	/**
	 * Blank a range, keeping newlines.
	 *
	 * @param {number} from - Start offset.
	 * @param {number} to - End offset (exclusive).
	 */
	function blank(from, to) {
		for (let at = from; at < to && at < out.length; at += 1) if (out[at] !== "\n") out[at] = " ";
	}

	while (index < source.length) {
		const char = source[index];
		const next = source[index + 1];

		if ((!python && char === "/" && next === "/") || (python && char === "#")) {
			const end = source.indexOf("\n", index);
			const stop = end === -1 ? source.length : end;

			blank(index, stop);
			index = stop;
		} else if (!python && char === "/" && next === "*") {
			const end = source.indexOf("*/", index + 2);
			const stop = end === -1 ? source.length : end + 2;

			blank(index, stop);
			index = stop;
		} else if (python && (source.startsWith('"""', index) || source.startsWith("'''", index))) {
			const quote = source.slice(index, index + 3);
			const end = source.indexOf(quote, index + 3);
			const stop = end === -1 ? source.length : end + 3;

			blank(index, stop);
			index = stop;
		} else if (!python && char === "/" && regexLiteralEnd(source, index) !== -1) {
			const end = regexLiteralEnd(source, index);

			blank(index + 1, end);
			index = end;
		} else if (char === '"' || char === "'" || (!python && char === "`")) {
			let at = index + 1;

			while (at < source.length && source[at] !== char) {
				if (source[at] === "\\") at += 1;
				if (char !== "`" && source[at] === "\n") break;
				at += 1;
			}

			blank(index, at + 1);
			index = at + 1;
		} else {
			index += 1;
		}
	}

	return out.join("");
}

/** Mutation operators: a pattern over masked code and the replacement for each match. */
const OPERATORS = [
	{ name: "equality", pattern: /===|!==/gu, replace: function flip(text) { return text === "===" ? "!==" : "==="; } },
	{ name: "equality", pattern: /(?<![=!<>])==(?!=)|!=(?!=)/gu, replace: function flip(text) { return text === "==" ? "!=" : "=="; } },
	{ name: "boundary", pattern: /(?<=\s)(<=|>=|<|>)(?=\s)/gu, replace: function shift(text) { return { "<=": "<", ">=": ">", "<": "<=", ">": ">=" }[text]; } },
	{ name: "logical", pattern: /(?<=\s)(&&|\|\|)(?=\s)/gu, replace: function swap(text) { return text === "&&" ? "||" : "&&"; } },
	{ name: "logical", pattern: /(?<=\s)(and|or)(?=\s)/gu, python: true, replace: function swap(text) { return text === "and" ? "or" : "and"; } },
	{ name: "arithmetic", pattern: /(?<=\s)([+\-*/])(?=\s)/gu, replace: function swap(text) { return { "+": "-", "-": "+", "*": "/", "/": "*" }[text]; } },
	{ name: "boolean", pattern: /\b(true|false)\b/gu, js: true, replace: function negate(text) { return text === "true" ? "false" : "true"; } },
	{ name: "boolean", pattern: /\b(True|False)\b/gu, python: true, replace: function negate(text) { return text === "True" ? "False" : "True"; } },
	{ name: "constant", pattern: /(?<![\w.$])\d+(?:\.\d+)?(?![\w.])/gu, replace: function bump(text) { return text.includes(".") ? String(Number(text) + 0.1) : String(Number(text) + 1); } },
	{ name: "negation", pattern: /!(?=[\w($])/gu, js: true, replace: function drop() { return ""; } },
	{ name: "negation", pattern: /\bnot\s+/gu, python: true, replace: function drop() { return ""; } },
];

/**
 * Generate mutants for a source.
 *
 * @param {string} source - Source text.
 * @param {{ python: boolean, lines?: [number, number] }} options - Language and optional line range.
 * @returns {Array<{ offset: number, length: number, replacement: string, operator: string, line: number, original: string }>} Mutants in source order.
 */
export function generateMutants(source, options) {
	const masked = mask(source, options.python);
	const mutants = [];
	const lineStarts = [0];

	for (let at = 0; at < source.length; at += 1) if (source[at] === "\n") lineStarts.push(at + 1);

	/**
	 * Line number of an offset.
	 *
	 * @param {number} offset - Offset.
	 * @returns {number} 1-based line.
	 */
	function lineOf(offset) {
		let low = 0;
		let high = lineStarts.length - 1;

		while (low < high) {
			const middle = Math.ceil((low + high) / 2);

			if (lineStarts[middle] <= offset) low = middle;
			else high = middle - 1;
		}

		return low + 1;
	}

	for (const operator of OPERATORS) {
		if (operator.python && !options.python) continue;
		if (operator.js && options.python) continue;

		for (const match of masked.matchAll(operator.pattern)) {
			const line = lineOf(match.index);
			const text = source.slice(lineStarts[line - 1], source.indexOf("\n", match.index) === -1 ? source.length : source.indexOf("\n", match.index));

			if (options.lines && (line < options.lines[0] || line > options.lines[1])) continue;
			// Imports, type annotations and decorators are not behavior.
			if (/^\s*(import|export\s+(type|interface)|from\s+\S+\s+import|@|type\s+\w+\s*=|interface\s)/u.test(text)) continue;

			const replacement = operator.replace(match[0]);

			if (replacement === undefined || replacement === match[0]) continue;

			mutants.push({ offset: match.index, length: match[0].length, replacement, operator: operator.name, line, original: text.trim() });
		}
	}

	return mutants.sort(function bySource(a, b) {
		return a.offset - b.offset;
	});
}

/**
 * Apply one mutant.
 *
 * @param {string} source - Original source.
 * @param {{ offset: number, length: number, replacement: string }} mutant - The mutant.
 * @returns {string} Mutated source.
 */
export function applyMutant(source, mutant) {
	return source.slice(0, mutant.offset) + mutant.replacement + source.slice(mutant.offset + mutant.length);
}

/**
 * Pick at most `max` mutants spread evenly over the list.
 *
 * @param {Array<unknown>} mutants - All mutants.
 * @param {number} max - Cap.
 * @returns {Array<unknown>} The sample.
 */
export function sample(mutants, max) {
	if (mutants.length <= max) return mutants;

	const step = mutants.length / max;

	return Array.from({ length: max }, function pick(_, index) {
		return mutants[Math.floor(index * step)];
	});
}

/**
 * Run the test command.
 *
 * @param {string[]} command - Command and arguments.
 * @param {number} timeout - Timeout in milliseconds.
 * @returns {{ status: "pass" | "fail" | "timeout", ms: number }} Outcome.
 */
function runTests(command, timeout) {
	const started = Date.now();
	const result = spawnSync(command[0], command.slice(1), { stdio: "ignore", timeout, shell: process.platform === "win32" });
	const ms = Date.now() - started;

	if (result.error?.code === "ETIMEDOUT" || result.signal === "SIGTERM") return { status: "timeout", ms };

	return { status: result.status === 0 ? "pass" : "fail", ms };
}

/**
 * Parse arguments.
 *
 * @param {string[]} argv - Arguments after the script path.
 * @returns {{ file: string, lines?: [number, number], max: number, timeout?: number, minScore?: number, json: boolean, command: string[] }} Options.
 */
export function parseArgs(argv) {
	const separator = argv.indexOf("--");

	if (separator === -1 || separator === argv.length - 1) throw new Error("usage: mutate.mjs --file <path> [--lines a-b] [--max n] [--timeout ms] [--min-score n] [--json] -- <test command...>");

	const own = argv.slice(0, separator);
	const read = function value(name) {
		const index = own.indexOf(name);

		return index === -1 ? undefined : own[index + 1];
	};
	const file = read("--file");

	if (!file) throw new Error("--file is required");

	const range = read("--lines")?.split("-").map(Number);

	return {
		file,
		lines: range && range.length === 2 && range.every(Number.isFinite) ? [range[0], range[1]] : undefined,
		max: Number(read("--max") ?? 200),
		timeout: read("--timeout") ? Number(read("--timeout")) : undefined,
		minScore: read("--min-score") ? Number(read("--min-score")) : undefined,
		json: own.includes("--json"),
		command: argv.slice(separator + 1),
	};
}

/**
 * Entry point.
 *
 * @param {string[]} argv - Arguments after the script path.
 * @returns {number} Exit code.
 */
function main(argv) {
	let options;

	try {
		options = parseArgs(argv);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		return 2;
	}

	const file = resolve(options.file);

	if (!existsSync(file)) {
		console.error(`No such file: ${options.file}`);
		return 2;
	}

	const original = readFileSync(file, "utf8");

	try {
		// Mutation testing edits the source in place; prove it is writable before touching anything.
		writeFileSync(file, original);
	} catch (error) {
		console.error(`Cannot write ${options.file} (${error.code ?? error.message}). Mutation testing edits the file in place and restores it; run it where the workspace is writable.`);
		return 2;
	}
	const python = extname(file) === ".py";
	const restore = function restoreSource() {
		writeFileSync(file, original);
	};

	for (const signal of ["SIGINT", "SIGTERM"]) {
		process.on(signal, function interrupted() {
			restore();
			process.exit(130);
		});
	}

	const baseline = runTests(options.command, 10 * 60_000);

	if (baseline.status !== "pass") {
		console.error("The test command does not pass on the unmutated source; fix that first.");
		return 2;
	}

	const timeout = options.timeout ?? Math.max(10_000, baseline.ms * 5);
	const mutants = sample(generateMutants(original, { python, lines: options.lines }), options.max);
	const results = [];

	try {
		for (const mutant of mutants) {
			writeFileSync(file, applyMutant(original, mutant));

			const outcome = runTests(options.command, timeout);

			results.push({ ...mutant, status: outcome.status === "pass" ? "survived" : outcome.status === "timeout" ? "timeout" : "killed" });
			if (!options.json) process.stdout.write(outcome.status === "pass" ? "S" : ".");
		}
	} finally {
		restore();
	}

	const survived = results.filter(function isSurvivor(result) {
		return result.status === "survived";
	});
	const score = results.length === 0 ? 100 : Math.round(((results.length - survived.length) / results.length) * 1000) / 10;

	if (options.json) {
		console.log(JSON.stringify({ file: options.file, mutants: results.length, score, survived }, null, 2));
	} else {
		console.log(`\n\n${options.file}: ${results.length} mutants, ${results.length - survived.length} killed, ${survived.length} survived. Mutation score ${score}%.`);

		for (const mutant of survived) {
			console.log(`  survived  ${options.file}:${mutant.line}  ${mutant.operator}: ${original.slice(mutant.offset, mutant.offset + mutant.length)} -> ${mutant.replacement || "(removed)"}    ${mutant.original.slice(0, 90)}`);
		}

		if (survived.length > 0) console.log("\nEach survivor is a behavior no test checks. Add the assertion that would fail for it.");
	}

	return options.minScore !== undefined && score < options.minScore ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
