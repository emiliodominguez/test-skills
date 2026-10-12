#!/usr/bin/env node
// Static audit of a test suite for tests that cannot fail or do not run: focused and skipped tests,
// tests without assertions, tautologies, mocks of the module under test, swallowed errors, sleeps
// and retries. Zero dependencies; JavaScript/TypeScript, Python and Go.
//
//   node audit-tests.mjs                 # scan the current directory
//   node audit-tests.mjs src tests       # scan some paths
//   node audit-tests.mjs --json          # machine-readable findings
//   node audit-tests.mjs --fail-on warn  # exit 1 on warnings too (default: errors only)
//
// Silence a reviewed finding with a comment on the same or the previous line:
//   // audit-tests-ignore no-assertion: asserts through the page object
//
// Exit codes: 0 clean, 1 findings at or above --fail-on, 2 usage error.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Directories never scanned. */
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage", "out", ".next", ".nuxt", "vendor", ".venv", "venv", "__pycache__", "target", ".turbo"]);

/** Severity order for filtering. */
const LEVELS = { info: 0, warn: 1, error: 2 };

/** What each rule means and what to do about it. */
export const RULES = {
	focused: { level: "error", fix: "Remove the focus marker; it silently disables every other test in the file or run." },
	skipped: { level: "warn", fix: "Fix or delete the test, or record an owner and a reason; a skip is missing coverage." },
	"no-assertion": { level: "error", fix: "Assert an observable result; a test without assertions passes whatever the code does." },
	tautology: { level: "error", fix: "Compare against an independently known expected value, not the value itself or a constant." },
	"weak-assertion": { level: "warn", fix: "Assert the value, not only that it exists, is truthy or that a mock was called." },
	"snapshot-only": { level: "info", fix: "Pair the snapshot with an assertion of the contract; snapshots get re-recorded without review." },
	"mocks-subject": { level: "error", fix: "Mock the boundaries of the unit, never the unit itself; this test checks the mock." },
	swallowed: { level: "warn", fix: "Let the error fail the test, or assert on it explicitly." },
	sleep: { level: "warn", fix: "Wait for an observable condition instead of a fixed delay; sleeps are slow and flaky." },
	retries: { level: "warn", fix: "Find the nondeterminism; retries hide real failures and races." },
	"expected-failure": { level: "warn", fix: "An expected failure passes while the bug exists; link the issue and an owner." },
};

/**
 * Whether a file name looks like a test file.
 *
 * @param {string} file - Path.
 * @returns {boolean} True for test files.
 */
export function isTestFile(file) {
	const name = basename(file);

	return (
		/\.(test|spec|e2e|cy)\.[cm]?[jt]sx?$/u.test(name) ||
		/(^|[\\/])__tests__[\\/].+\.[cm]?[jt]sx?$/u.test(file) ||
		/^test_.+\.py$|_test\.py$/u.test(name) ||
		/_test\.go$/u.test(name)
	);
}

/**
 * Whether a file name is a test runner configuration that can hold retries.
 *
 * @param {string} file - Path.
 * @returns {boolean} True for runner configs.
 */
export function isRunnerConfig(file) {
	return /^(playwright|vitest|jest|cypress|vite)\.config\.[cm]?[jt]s$|^(pytest\.ini|pyproject\.toml|setup\.cfg|tox\.ini)$/u.test(basename(file));
}

/**
 * Recursively list candidate files under the given paths.
 *
 * @param {string[]} paths - Files or directories.
 * @returns {string[]} Files to scan.
 */
export function collectFiles(paths) {
	const files = [];

	/**
	 * Visit one path.
	 *
	 * @param {string} path - File or directory.
	 */
	function visit(path) {
		const stats = statSync(path);

		if (stats.isDirectory()) {
			for (const entry of readdirSync(path)) {
				if (!SKIP_DIRS.has(entry)) visit(join(path, entry));
			}
		} else if (isTestFile(path) || isRunnerConfig(path)) {
			files.push(path);
		}
	}

	for (const path of paths) visit(path);

	return files.sort();
}

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
 * Replace the contents of comments and string literals with spaces, keeping offsets and line
 * breaks, so pattern matches only see code. Template literal text is blanked too.
 *
 * @param {string} source - JavaScript or TypeScript source.
 * @returns {string} Masked source of the same length.
 */
export function maskJs(source) {
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

		if (char === "/" && next === "/") {
			const end = source.indexOf("\n", index);
			const stop = end === -1 ? source.length : end;

			blank(index, stop);
			index = stop;
		} else if (char === "/" && next === "*") {
			const end = source.indexOf("*/", index + 2);
			const stop = end === -1 ? source.length : end + 2;

			blank(index, stop);
			index = stop;
		} else if (char === "/" && regexLiteralEnd(source, index) !== -1) {
			const end = regexLiteralEnd(source, index);

			blank(index + 1, end);
			index = end;
		} else if (char === '"' || char === "'" || char === "`") {
			let at = index + 1;

			while (at < source.length && source[at] !== char) {
				if (source[at] === "\\") at += 1;
				if (char !== "`" && source[at] === "\n") break;
				at += 1;
			}

			blank(index + 1, at);
			index = at + 1;
		} else {
			index += 1;
		}
	}

	return out.join("");
}

/**
 * Offset of the parenthesis closing the one at `open`, in masked source.
 *
 * @param {string} masked - Masked source.
 * @param {number} open - Offset of an opening parenthesis.
 * @returns {number} Offset of the matching closing parenthesis, or the source length.
 */
function closingParen(masked, open) {
	let depth = 0;

	for (let at = open; at < masked.length; at += 1) {
		if (masked[at] === "(") depth += 1;
		else if (masked[at] === ")") {
			depth -= 1;
			if (depth === 0) return at;
		}
	}

	return masked.length;
}

/**
 * Line number (1-based) of an offset.
 *
 * @param {string} source - Source text.
 * @param {number} offset - Offset.
 * @returns {number} Line number.
 */
function lineOf(source, offset) {
	let line = 1;

	for (let at = 0; at < offset && at < source.length; at += 1) if (source[at] === "\n") line += 1;

	return line;
}

/** Calls that count as assertions in JavaScript and TypeScript tests. */
const JS_ASSERTION = /\b(expect|assert|should|expectTypeOf|assertType)\b|\.should\(|\bt\.(is|not|true|false|deepEqual|like|throws|throwsAsync|regex|snapshot|pass|fail)\(|\b(verify|check|assert|expect|must)[A-Z]\w*\s*\(/u;

/** Assertions that only prove existence, truthiness or a call. */
const WEAK_MATCHER = /\.(toBeDefined|toBeTruthy|toHaveBeenCalled|toBeCalled|not\.toBeNull|not\.toBeUndefined|not\.toThrow)\(\s*\)/gu;

/** Any jest/vitest/playwright-style matcher call. */
const ANY_MATCHER = /\.(?:not\.)?(?:resolves\.|rejects\.)?to[A-Z]\w*\(/gu;

/**
 * Find test cases (`it(...)`, `test(...)` and their modifiers) in JavaScript or TypeScript.
 *
 * @param {string} source - Source text.
 * @param {string} masked - Masked source from {@link maskJs}.
 * @returns {Array<{ start: number, end: number, modifiers: string[] }>} Test calls with their full text range.
 */
export function findJsTests(source, masked) {
	const tests = [];
	const pattern = /(?<![\w.$])(it|test)((?:\.(?:only|skip|todo|fixme|fails|failing|concurrent|sequential|slow))*)(\.each)?\s*([(`])/gu;

	for (let match = pattern.exec(masked); match; match = pattern.exec(masked)) {
		const modifiers = match[2] ? match[2].split(".").filter(Boolean) : [];
		let open = match.index + match[0].length - 1;

		if (match[3]) {
			// `test.each(table)(...)` or test.each`table`(...): skip the table first.
			const tableEnd = masked[open] === "`" ? masked.indexOf("`", open + 1) : closingParen(masked, open);
			const after = masked.slice(tableEnd + 1).search(/\S/u);

			open = tableEnd + 1 + after;
			if (masked[open] !== "(") continue;
		} else if (masked[open] !== "(") {
			continue;
		}

		const end = closingParen(masked, open);

		tests.push({ start: match.index, end: end + 1, modifiers });
		pattern.lastIndex = match.index + match[0].length;
	}

	return tests;
}

/**
 * Whether a finding is silenced by an ignore comment on its line or the line before.
 *
 * @param {string[]} lines - Source lines.
 * @param {number} line - 1-based line of the finding.
 * @param {string} rule - Rule id.
 * @returns {boolean} True when ignored.
 */
function ignored(lines, line, rule) {
	const nearby = `${lines[line - 2] ?? ""}\n${lines[line - 1] ?? ""}`;
	const match = /audit-tests-ignore\s+([\w,-]+)/u.exec(nearby);

	return match !== null && (match[1] === "all" || match[1].split(",").includes(rule));
}

/**
 * Audit one JavaScript or TypeScript test file.
 *
 * @param {string} file - Path, used to detect mocks of the subject.
 * @param {string} source - File contents.
 * @returns {Array<{ line: number, rule: string, detail: string }>} Findings.
 */
export function auditJs(file, source) {
	const findings = [];
	const masked = maskJs(source);

	/**
	 * Record a finding at an offset.
	 *
	 * @param {number} offset - Offset in the source.
	 * @param {string} rule - Rule id.
	 * @param {string} detail - Evidence.
	 */
	function add(offset, rule, detail) {
		findings.push({ line: lineOf(source, offset), rule, detail: detail.replaceAll(/\s+/gu, " ").trim().slice(0, 120) });
	}

	for (const match of masked.matchAll(/(?<![\w.$])(?:(?:describe|context|suite)\.only|fit|fdescribe)\s*\(/gu)) add(match.index, "focused", source.slice(match.index, match.index + 40));
	for (const match of masked.matchAll(/(?<![\w.$])(?:(?:describe|context|suite)\.(?:skip|todo)|xit|xtest|xdescribe)\s*\(/gu)) add(match.index, "skipped", source.slice(match.index, match.index + 40));

	for (const test of findJsTests(source, masked)) {
		const code = masked.slice(test.start, test.end);
		const title = source.slice(test.start, Math.min(test.end, test.start + 80));

		if (test.modifiers.includes("only")) add(test.start, "focused", title);
		if (test.modifiers.some(function isSkip(modifier) {
			return modifier === "skip" || modifier === "todo" || modifier === "fixme";
		})) {
			add(test.start, "skipped", title);
			continue;
		}
		if (test.modifiers.includes("fails") || test.modifiers.includes("failing")) add(test.start, "expected-failure", title);

		const body = code.replace(/^[\s\S]*?,/u, "");

		if (!JS_ASSERTION.test(body)) {
			add(test.start, "no-assertion", title);
			continue;
		}

		const matchers = [...code.matchAll(ANY_MATCHER)].length;
		const weak = [...code.matchAll(WEAK_MATCHER)].length;
		const snapshots = [...code.matchAll(/\.(toMatchSnapshot|toMatchInlineSnapshot|toMatchFileSnapshot|toHaveScreenshot|toMatchAriaSnapshot)\(/gu)].length;

		if (matchers > 0 && weak === matchers) add(test.start, "weak-assertion", title);
		if (matchers > 0 && snapshots === matchers) add(test.start, "snapshot-only", title);
	}

	const literal = String.raw`(?:true|false|null|undefined|-?\d+(?:\.\d+)?|"[^"]*"|'[^']*')`;
	const tautologies = [
		new RegExp(String.raw`expect\(\s*(${literal})\s*\)\s*\.\s*(?:toBe|toEqual|toStrictEqual)\(\s*\1\s*\)`, "gu"),
		new RegExp(String.raw`expect\(\s*(${literal})\s*\)\s*\.\s*(?:toBeTruthy|toBeDefined)\(\s*\)`, "gu"),
		/expect\(\s*([\w$.]+)\s*\)\s*\.\s*(?:toBe|toEqual|toStrictEqual)\(\s*\1\s*\)/gu,
		/assert\.(?:equal|strictEqual|deepEqual|deepStrictEqual)\(\s*([\w$.]+)\s*,\s*\1\s*[,)]/gu,
		/assert\(\s*true\s*[,)]/gu,
	];

	for (const pattern of tautologies) {
		for (const match of source.matchAll(pattern)) {
			if (masked.slice(match.index, match.index + 6) === source.slice(match.index, match.index + 6)) add(match.index, "tautology", match[0]);
		}
	}

	const subject = basename(file).replace(/\.(test|spec|e2e|cy)\.[cm]?[jt]sx?$/u, "");

	for (const match of source.matchAll(/\b(?:vi|jest)\.(?:mock|doMock)\(\s*["']([^"']+)["']/gu)) {
		const mocked = basename(match[1]).replace(/\.[cm]?[jt]sx?$/u, "");

		if (mocked === subject || (mocked === "index" && basename(match[1].replace(/\/index(\.[cm]?[jt]sx?)?$/u, "")) === subject)) add(match.index, "mocks-subject", match[0]);
	}

	for (const match of masked.matchAll(/catch\s*(?:\(\s*\w*\s*\))?\s*\{\s*\}|\.catch\(\s*(?:\(\s*\w*\s*\)\s*=>\s*(?:\{\s*\}|undefined|null)|function\s*\w*\s*\(\s*\w*\s*\)\s*\{\s*\})\s*\)/gu)) add(match.index, "swallowed", source.slice(match.index, match.index + 40));
	for (const match of masked.matchAll(/\b(?:waitForTimeout|sleep|delay)\s*\(\s*\d|\bcy\.wait\(\s*\d|new Promise\(\s*(?:\(?\s*\w+\s*\)?\s*=>|function\s*\w*\s*\(\s*\w+\s*\))\s*\{?\s*setTimeout\(/gu)) add(match.index, "sleep", source.slice(match.index, match.index + 50));

	const lines = source.split("\n");

	return findings.filter(function notIgnored(finding) {
		return !ignored(lines, finding.line, finding.rule);
	});
}

/**
 * Audit one Python test file.
 *
 * @param {string} source - File contents.
 * @returns {Array<{ line: number, rule: string, detail: string }>} Findings.
 */
export function auditPython(source) {
	const findings = [];
	const lines = source.split("\n");

	lines.forEach(function check(text, index) {
		const line = index + 1;

		if (/^\s*@(?:pytest\.mark\.skip|pytest\.mark\.skipif|unittest\.skip)/u.test(text) || /^\s*pytest\.skip\(/u.test(text)) findings.push({ line, rule: "skipped", detail: text.trim() });
		if (/^\s*@pytest\.mark\.xfail/u.test(text)) findings.push({ line, rule: "expected-failure", detail: text.trim() });
		if (/^\s*assert\s+(?:True|1|"[^"]+"|'[^']+')\s*(?:#.*)?$/u.test(text) || /^\s*assert\s+([\w.]+)\s*==\s*\1\s*(?:#.*)?$/u.test(text) || /^\s*assert\s+(\d+)\s*==\s*\1\s*$/u.test(text)) {
			findings.push({ line, rule: "tautology", detail: text.trim() });
		}
		if (/\btime\.sleep\(\s*\d/u.test(text) || /\bawait\s+asyncio\.sleep\(\s*\d/u.test(text)) findings.push({ line, rule: "sleep", detail: text.trim() });
		if (/^\s*except(?:\s+\w+(?:\s+as\s+\w+)?)?\s*:\s*(?:pass)?\s*$/u.test(text) && /^\s*pass\s*$/u.test(lines[index + 1] ?? "pass")) findings.push({ line, rule: "swallowed", detail: text.trim() });

		const definition = /^(\s*)(?:async\s+)?def\s+(test\w*)\s*\(/u.exec(text);

		if (!definition) return;

		const indent = definition[1].length;
		const body = [];

		for (let at = index + 1; at < lines.length; at += 1) {
			const current = lines[at];

			if (current.trim() === "") continue;
			if (current.length - current.trimStart().length <= indent) break;
			body.push(current);
		}

		const decorators = lines.slice(Math.max(0, index - 3), index).join("\n");
		const asserted = /\bassert\b|self\.(?:assert|fail)\w*\(|pytest\.(?:raises|warns|fail)\(|\.assert_\w+\(|\bexpect\(|\b(?:verify|check|assert)_\w+\(/u.test(body.join("\n"));

		if (!asserted && !/@pytest\.mark\.(?:skip|xfail)|@unittest\.skip/u.test(decorators)) findings.push({ line, rule: "no-assertion", detail: text.trim() });
	});

	return findings.filter(function notIgnored(finding) {
		return !ignored(lines, finding.line, finding.rule);
	});
}

/**
 * Audit one Go test file.
 *
 * @param {string} source - File contents.
 * @returns {Array<{ line: number, rule: string, detail: string }>} Findings.
 */
export function auditGo(source) {
	const findings = [];
	const masked = maskJs(source);

	for (const match of masked.matchAll(/\bt\.Skip(?:Now|f)?\(/gu)) findings.push({ line: lineOf(source, match.index), rule: "skipped", detail: source.slice(match.index, match.index + 40) });
	for (const match of masked.matchAll(/\btime\.Sleep\(/gu)) findings.push({ line: lineOf(source, match.index), rule: "sleep", detail: source.slice(match.index, match.index + 40) });

	for (const match of masked.matchAll(/func\s+(Test\w+)\s*\(\s*\w+\s+\*testing\.T\s*\)\s*\{/gu)) {
		let depth = 0;
		let end = masked.length;

		for (let at = match.index + match[0].length - 1; at < masked.length; at += 1) {
			if (masked[at] === "{") depth += 1;
			else if (masked[at] === "}") {
				depth -= 1;
				if (depth === 0) {
					end = at;
					break;
				}
			}
		}

		const body = masked.slice(match.index, end);

		if (!/\b\w+\.(?:Error|Errorf|Fatal|Fatalf|Fail|FailNow)\(|\b(?:assert|require)\.\w+\(|\bt\.Run\(/u.test(body)) findings.push({ line: lineOf(source, match.index), rule: "no-assertion", detail: match[1] });
	}

	const lines = source.split("\n");

	return findings.filter(function notIgnored(finding) {
		return !ignored(lines, finding.line, finding.rule);
	});
}

/**
 * Audit a runner configuration for retries.
 *
 * @param {string} source - File contents.
 * @returns {Array<{ line: number, rule: string, detail: string }>} Findings.
 */
export function auditConfig(source) {
	const findings = [];

	source.split("\n").forEach(function check(text, index) {
		if (/\b(?:retries|retry)\s*:\s*(?:process\.env\.CI\s*\?\s*)?[1-9]/u.test(text) || /retryTimes\(\s*[1-9]/u.test(text) || /--reruns[= ]+[1-9]|\breruns\s*=\s*[1-9]/u.test(text)) {
			findings.push({ line: index + 1, rule: "retries", detail: text.trim() });
		}
	});

	return findings;
}

/**
 * Audit one file by its kind.
 *
 * @param {string} file - Path.
 * @param {string} source - Contents.
 * @returns {Array<{ line: number, rule: string, detail: string }>} Findings.
 */
export function auditFile(file, source) {
	if (isRunnerConfig(file)) return auditConfig(source);

	const extension = extname(file);

	if (extension === ".py") return auditPython(source);
	if (extension === ".go") return auditGo(source);

	return auditJs(file, source);
}

/**
 * Format findings for a terminal.
 *
 * @param {Array<{ file: string, line: number, rule: string, level: string, detail: string }>} findings - Findings with files.
 * @param {number} scanned - Files scanned.
 * @returns {string} Report.
 */
export function formatReport(findings, scanned) {
	if (findings.length === 0) return `audit-tests: ${scanned} files, no findings.`;

	const lines = [];
	const counts = {};

	for (const finding of findings) {
		lines.push(`${finding.file}:${finding.line}  ${finding.level.padEnd(5)}  ${finding.rule.padEnd(16)} ${finding.detail}`);
		counts[finding.rule] = (counts[finding.rule] ?? 0) + 1;
	}

	lines.push("", `audit-tests: ${scanned} files, ${findings.length} findings`);

	for (const [rule, count] of Object.entries(counts).sort(function byCount(a, b) {
		return b[1] - a[1];
	})) {
		lines.push(`  ${String(count).padStart(4)}  ${rule}: ${RULES[rule].fix}`);
	}

	return lines.join("\n");
}

/**
 * Entry point.
 *
 * @param {string[]} argv - Arguments after the script path.
 * @returns {number} Exit code.
 */
function main(argv) {
	const json = argv.includes("--json");
	const failIndex = argv.indexOf("--fail-on");
	const failOn = failIndex === -1 ? "error" : argv[failIndex + 1];

	if (!(failOn in LEVELS)) {
		console.error("--fail-on must be info, warn or error");
		return 2;
	}

	const paths = argv.filter(function isPath(argument, index) {
		return !argument.startsWith("--") && (failIndex === -1 || index !== failIndex + 1);
	});
	const roots = (paths.length > 0 ? paths : ["."]).map(function absolute(path) {
		return resolve(path);
	});

	for (const root of roots) {
		if (!existsSync(root)) {
			console.error(`No such path: ${root}`);
			return 2;
		}
	}

	const files = collectFiles(roots);
	const findings = files.flatMap(function auditOne(file) {
		return auditFile(file, readFileSync(file, "utf8")).map(function withFile(finding) {
			return { file: relative(process.cwd(), file), level: RULES[finding.rule].level, ...finding };
		});
	});

	console.log(json ? JSON.stringify({ scanned: files.length, findings }, null, 2) : formatReport(findings, files.length));

	return findings.some(function failing(finding) {
		return LEVELS[finding.level] >= LEVELS[failOn];
	})
		? 1
		: 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
