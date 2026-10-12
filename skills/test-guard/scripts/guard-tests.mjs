#!/usr/bin/env node
// Guard against weakened tests: compares the working tree with a base revision and reports deleted
// tests, new skip or focus markers, removed or loosened assertions, rewritten expectations,
// re-recorded snapshots, lowered coverage thresholds, added retries and excluded tests.
// Zero dependencies; needs git.
//
//   node guard-tests.mjs                     # against the merge base with the default branch
//   node guard-tests.mjs --base HEAD         # only uncommitted changes
//   node guard-tests.mjs --base origin/main --json
//
// Exit codes: 0 nothing weakened, 1 something weakened (errors), 2 usage or git error.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Severity and advice per rule. */
export const RULES = {
	"deleted-test-file": { level: "error", fix: "Restore it, or state which behavior no longer exists and where it is covered now." },
	"removed-tests": { level: "error", fix: "Each removed case needs a reason: the behavior was removed, or it moved (name where)." },
	"added-focus": { level: "error", fix: "Remove the focus marker before committing; it disables the rest of the suite." },
	"added-skip": { level: "error", fix: "Fix the test or record an owner and a reason; a new skip hides a failure." },
	"removed-assertions": { level: "warn", fix: "Check that every removed assertion is replaced by an equal or stronger one." },
	"weakened-assertion": { level: "error", fix: "An exact assertion was replaced by an existence or truthiness check; restore the exact one." },
	"changed-expectation": { level: "warn", fix: "An expected value changed: confirm the requirement changed, not that the test was bent to the code." },
	"updated-snapshots": { level: "warn", fix: "Read every changed snapshot line; accept only the differences the change intended." },
	"lowered-threshold": { level: "error", fix: "Coverage or quality thresholds went down; add tests instead, or get explicit approval." },
	"added-retries": { level: "error", fix: "Retries hide failures; find the nondeterminism instead." },
	"excluded-tests": { level: "warn", fix: "Tests were excluded from the run; say why and for how long." },
	"no-test-changes": { level: "info", fix: "Source changed but no test did; check that existing tests cover the new behavior." },
};

/** Exact matchers that existence checks often replace. */
const EXACT = /\.(?:not\.)?(?:toBe|toEqual|toStrictEqual|toMatchObject|toHaveLength|toContain|toThrow\(\s*\S|toHaveBeenCalledWith|toHaveBeenCalledTimes|toHaveText|toHaveValue|toHaveURL|toHaveCount)\(/gu;

/** Matchers that only prove existence, truthiness or a call. */
const WEAK = /\.(?:toBeDefined|toBeTruthy|toHaveBeenCalled|toBeCalled|not\.toBeNull|not\.toBeUndefined|not\.toThrow)\(\s*\)/gu;

/**
 * Whether a path is a test file.
 *
 * @param {string} file - Path.
 * @returns {boolean} True for test files.
 */
export function isTestFile(file) {
	const name = basename(file);

	return /\.(test|spec|e2e|cy)\.[cm]?[jt]sx?$/u.test(name) || /(^|\/)__tests__\/.+\.[cm]?[jt]sx?$/u.test(file) || /^test_.+\.py$|_test\.py$/u.test(name) || /_test\.go$/u.test(name);
}

/**
 * Whether a path is a snapshot file.
 *
 * @param {string} file - Path.
 * @returns {boolean} True for snapshots.
 */
export function isSnapshot(file) {
	return /\.snap$|\.ambr$|(^|\/)__snapshots__\/|-snapshots\/.+\.(png|jpe?g|txt|ya?ml)$|\.golden(\.\w+)?$/u.test(file);
}

/**
 * Whether a path is a test runner, coverage or CI configuration.
 *
 * @param {string} file - Path.
 * @returns {boolean} True for configs that can weaken a suite.
 */
export function isTestConfig(file) {
	const name = basename(file);

	return (
		/^(playwright|vitest|jest|cypress|vite|karma|ava|mocha)\.config\.[cm]?[jt]s$|^\.mocharc|^\.nycrc|^\.c8rc|^codecov\.ya?ml$|^\.coveragerc$|^(pytest\.ini|pyproject\.toml|setup\.cfg|tox\.ini|package\.json)$/u.test(name) ||
		/^\.github\/workflows\/.+\.ya?ml$/u.test(file)
	);
}

/**
 * Count the test cases in a source.
 *
 * @param {string} source - Test file contents.
 * @returns {string[]} Test titles, or positional labels when untitled.
 */
export function testTitles(source) {
	const titles = [];

	for (const match of source.matchAll(/(?<![\w.$])(?:it|test)(?:\.(?:only|skip|todo|fixme|fails|concurrent|each\([^)]*\)))*\s*\(\s*(["'`])(.*?)\1/gu)) titles.push(match[2]);
	for (const match of source.matchAll(/^\s*(?:async\s+)?def\s+(test\w*)\s*\(/gmu)) titles.push(match[1]);
	for (const match of source.matchAll(/^func\s+(Test\w+)\s*\(/gmu)) titles.push(match[1]);

	return titles;
}

/**
 * Count assertion calls in a source.
 *
 * @param {string} source - Test file contents.
 * @returns {number} Assertion count.
 */
export function countAssertions(source) {
	return [...source.matchAll(/\bexpect\s*\(|\bassert\b|\.should\(|self\.assert\w+\(|\bt\.(?:Error|Errorf|Fatal|Fatalf)\(|\b(?:assert|require)\.\w+\(/gu)].length;
}

/**
 * Count focus and skip markers in a source.
 *
 * @param {string} source - Test file contents.
 * @returns {{ focus: number, skip: number }} Marker counts.
 */
export function countMarkers(source) {
	const focus = [...source.matchAll(/(?<![\w.$])(?:(?:it|test|describe|context|suite)\.only|fit|fdescribe)\s*\(/gu)].length;
	const skip = [...source.matchAll(/(?<![\w.$])(?:(?:it|test|describe|context|suite)\.(?:skip|todo|fixme)|xit|xtest|xdescribe)\s*\(|@pytest\.mark\.(?:skip|xfail)|@unittest\.skip|\bt\.Skip(?:Now|f)?\(/gu)].length;

	return { focus, skip };
}

/**
 * Compare two versions of a test file.
 *
 * @param {string} before - Contents at the base revision.
 * @param {string} after - Contents now.
 * @returns {Array<{ rule: string, detail: string }>} Findings.
 */
export function compareTestFile(before, after) {
	const findings = [];
	const oldTitles = testTitles(before);
	const newTitles = testTitles(after);
	const removed = oldTitles.filter(function gone(title) {
		return !newTitles.includes(title);
	});

	if (newTitles.length < oldTitles.length) {
		findings.push({ rule: "removed-tests", detail: `${oldTitles.length} -> ${newTitles.length} tests${removed.length > 0 ? `; gone: ${removed.slice(0, 5).join(" | ")}` : ""}` });
	}

	const oldMarkers = countMarkers(before);
	const newMarkers = countMarkers(after);

	if (newMarkers.focus > oldMarkers.focus) findings.push({ rule: "added-focus", detail: `${oldMarkers.focus} -> ${newMarkers.focus} focus markers` });
	if (newMarkers.skip > oldMarkers.skip) findings.push({ rule: "added-skip", detail: `${oldMarkers.skip} -> ${newMarkers.skip} skip markers` });

	const oldAssertions = countAssertions(before);
	const newAssertions = countAssertions(after);

	if (newAssertions < oldAssertions) findings.push({ rule: "removed-assertions", detail: `${oldAssertions} -> ${newAssertions} assertions` });

	const oldExact = [...before.matchAll(EXACT)].length;
	const newExact = [...after.matchAll(EXACT)].length;
	const oldWeak = [...before.matchAll(WEAK)].length;
	const newWeak = [...after.matchAll(WEAK)].length;

	if (newWeak > oldWeak && newExact < oldExact) findings.push({ rule: "weakened-assertion", detail: `exact matchers ${oldExact} -> ${newExact}, weak matchers ${oldWeak} -> ${newWeak}` });

	return findings;
}

/**
 * Pair removed and added assertion lines from a unified diff whose expectations changed.
 *
 * @param {string} diff - Unified diff of one file with zero context.
 * @returns {Array<{ rule: string, detail: string }>} Changed expectations.
 */
export function changedExpectations(diff) {
	const findings = [];
	const removed = [];
	const added = [];

	/**
	 * Split an assertion line into its subject and its expectation.
	 *
	 * @param {string} line - Diff line without the marker.
	 * @returns {{ subject: string, expected: string } | null} Parts, or null when not an assertion.
	 */
	function split(line) {
		const jest = /^\s*(?:await\s+)?(expect\(.*?\))\s*((?:\.\w+)*\.to\w+\(.*\));?\s*$/u.exec(line);

		if (jest) return { subject: jest[1], expected: jest[2] };

		const python = /^\s*(assert\s+.*?)\s*(==|!=|<=|>=|<|>|\bis\b|\bin\b)\s*(.+)$/u.exec(line);

		if (python) return { subject: `${python[1]} ${python[2]}`, expected: python[3] };

		const node = /^\s*(assert\.\w+\(\s*[^,]+),\s*(.+)\)\s*;?\s*$/u.exec(line);

		return node ? { subject: node[1], expected: node[2] } : null;
	}

	/**
	 * Pair the collected lines of one hunk.
	 */
	function flush() {
		for (const before of removed) {
			const old = split(before);

			if (!old) continue;

			const match = added.map(split).find(function sameSubject(candidate) {
				return candidate !== null && candidate.subject === old.subject && candidate.expected !== old.expected;
			});

			if (match) findings.push({ rule: "changed-expectation", detail: `${old.subject}: ${old.expected.trim()} -> ${match.expected.trim()}`.slice(0, 160) });
		}

		removed.length = 0;
		added.length = 0;
	}

	for (const line of diff.split("\n")) {
		if (line.startsWith("@@")) flush();
		else if (line.startsWith("-") && !line.startsWith("---")) removed.push(line.slice(1));
		else if (line.startsWith("+") && !line.startsWith("+++")) added.push(line.slice(1));
	}

	flush();

	return findings;
}

/**
 * Compare two versions of a test or coverage configuration.
 *
 * @param {string} before - Contents at the base revision.
 * @param {string} after - Contents now.
 * @returns {Array<{ rule: string, detail: string }>} Findings.
 */
export function compareConfig(before, after) {
	const findings = [];

	/**
	 * Threshold values by key.
	 *
	 * @param {string} source - Config text.
	 * @returns {Map<string, number>} Values.
	 */
	function thresholds(source) {
		const values = new Map();

		for (const match of source.matchAll(/["']?\b(lines|branches|functions|statements|fail_under|fail-under|cov-fail-under|mutationScore|break|high|low|minimum_coverage|target)\b["']?\s*[:=\s]\s*(\d+(?:\.\d+)?)/gu)) {
			values.set(match[1], Number(match[2]));
		}

		return values;
	}

	const oldThresholds = thresholds(before);

	for (const [key, value] of thresholds(after)) {
		const old = oldThresholds.get(key);

		if (old !== undefined && value < old) findings.push({ rule: "lowered-threshold", detail: `${key}: ${old} -> ${value}` });
	}

	/**
	 * Highest retry count in a config.
	 *
	 * @param {string} source - Config text.
	 * @returns {number} Retries.
	 */
	function retries(source) {
		const counts = [...source.matchAll(/\b(?:retries|retry|retryTimes|reruns)\b["']?\s*[:=(\s]\s*(?:process\.env\.CI\s*\?\s*)?(\d+)/gu)].map(function toNumber(match) {
			return Number(match[1]);
		});

		return Math.max(0, ...counts);
	}

	if (retries(after) > retries(before)) findings.push({ rule: "added-retries", detail: `retries ${retries(before)} -> ${retries(after)}` });

	const exclusion = /\b(?:exclude|testPathIgnorePatterns|testIgnore|modulePathIgnorePatterns|coveragePathIgnorePatterns|--ignore|--deselect|norecursedirs|skip-tests|--testPathIgnorePatterns)\b/u;
	const oldLines = new Set(before.split("\n"));
	const added = after.split("\n").filter(function isNew(line) {
		return !oldLines.has(line);
	});
	const addedExclusions = added.filter(function excludes(line) {
		return exclusion.test(line);
	});

	if (addedExclusions.length > 0) findings.push({ rule: "excluded-tests", detail: addedExclusions.slice(0, 3).join(" | ").trim().slice(0, 160) });

	return findings;
}

/**
 * Run git and return its output.
 *
 * @param {string[]} args - Git arguments.
 * @returns {string} Standard output.
 */
function git(args) {
	return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * Pick the base revision: the merge base with the default branch, else HEAD.
 *
 * @returns {string} Revision.
 */
function defaultBase() {
	for (const candidate of ["origin/HEAD", "origin/main", "origin/master", "main", "master"]) {
		try {
			const base = git(["merge-base", "HEAD", candidate]).trim();
			const head = git(["rev-parse", "HEAD"]).trim();

			if (base && base !== head) return base;
		} catch {
			// Try the next candidate.
		}
	}

	return "HEAD";
}

/**
 * Contents of a file at a revision, or null when absent.
 *
 * @param {string} revision - Git revision.
 * @param {string} path - Repository-relative path.
 * @returns {string | null} Contents.
 */
function showAt(revision, path) {
	try {
		return git(["show", `${revision}:${path}`]);
	} catch {
		return null;
	}
}

/**
 * Guard the working tree against a base revision.
 *
 * @param {string} base - Git revision to compare with.
 * @returns {Array<{ file: string, rule: string, level: string, detail: string }>} Findings.
 */
export function guard(base) {
	const findings = [];
	const changes = git(["diff", "--name-status", "-M", base])
		.split("\n")
		.filter(Boolean)
		.map(function parse(line) {
			const [status, ...paths] = line.split("\t");

			return { status: status[0], from: paths[0], to: paths.at(-1) };
		});
	const untracked = git(["ls-files", "--others", "--exclude-standard"])
		.split("\n")
		.filter(Boolean)
		.map(function asAdded(path) {
			return { status: "A", from: path, to: path };
		});
	let testsChanged = false;
	let sourceChanged = false;

	/**
	 * Record findings for a file.
	 *
	 * @param {string} file - Path.
	 * @param {Array<{ rule: string, detail: string }>} found - Findings without a file.
	 */
	function add(file, found) {
		for (const finding of found) findings.push({ file, level: RULES[finding.rule].level, ...finding });
	}

	for (const change of [...changes, ...untracked]) {
		const file = change.to;

		if (isSnapshot(file) || isSnapshot(change.from)) {
			testsChanged = true;
			if (change.status !== "A") add(file, [{ rule: "updated-snapshots", detail: change.status === "D" ? "snapshot deleted" : "snapshot changed" }]);
			continue;
		}

		if (isTestFile(file) || isTestFile(change.from)) {
			testsChanged = true;

			if (change.status === "D") {
				const before = showAt(base, change.from) ?? "";

				add(change.from, [{ rule: "deleted-test-file", detail: `${testTitles(before).length} tests deleted` }]);
				continue;
			}

			const before = showAt(base, change.from);

			if (before === null || !existsSync(file)) continue;

			const after = readFileSync(file, "utf8");

			add(file, compareTestFile(before, after));

			if (change.status === "M") add(file, changedExpectations(git(["diff", "-U0", base, "--", file])));
			continue;
		}

		if (isTestConfig(file)) {
			const before = showAt(base, change.from);

			if (before !== null && existsSync(file)) add(file, compareConfig(before, readFileSync(file, "utf8")));
			continue;
		}

		if (/\.(?:[cm]?[jt]sx?|py|go|rb|java|kt|cs|rs|php|swift|vue|svelte)$/u.test(file) && change.status !== "D") sourceChanged = true;
	}

	if (sourceChanged && !testsChanged) findings.push({ file: ".", level: "info", rule: "no-test-changes", detail: "source files changed, no test file did" });

	return findings;
}

/**
 * Format findings for a terminal.
 *
 * @param {ReturnType<typeof guard>} findings - Findings.
 * @param {string} base - Base revision or its label.
 * @returns {string} Report.
 */
export function formatReport(findings, base) {
	const errors = findings.filter(function isError(finding) {
		return finding.level === "error";
	});
	const lines = findings.map(function describe(finding) {
		return `${finding.level.padEnd(5)}  ${finding.rule.padEnd(20)} ${finding.file}  ${finding.detail}`;
	});
	const rules = [...new Set(findings.map(function ruleOf(finding) {
		return finding.rule;
	}))];

	lines.push("", `guard-tests vs ${base}: ${errors.length > 0 ? "WEAKENED" : "ok"} (${errors.length} errors, ${findings.length - errors.length} other)`);

	for (const rule of rules) lines.push(`  ${rule}: ${RULES[rule].fix}`);

	return lines.join("\n").trim();
}

/**
 * Entry point.
 *
 * @param {string[]} argv - Arguments after the script path.
 * @returns {number} Exit code.
 */
function main(argv) {
	const baseIndex = argv.indexOf("--base");
	let base;

	try {
		git(["rev-parse", "--show-toplevel"]);
		base = baseIndex === -1 ? defaultBase() : git(["rev-parse", "--verify", argv[baseIndex + 1] ?? ""]).trim();
	} catch (error) {
		console.error(`guard-tests: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
		return 2;
	}

	process.chdir(git(["rev-parse", "--show-toplevel"]).trim());

	const findings = guard(base);

	const label = baseIndex === -1 ? `merge base ${base.slice(0, 12)}` : argv[baseIndex + 1];

	console.log(argv.includes("--json") ? JSON.stringify({ base, findings }, null, 2) : formatReport(findings, label));

	return findings.some(function isError(finding) {
		return finding.level === "error";
	})
		? 1
		: 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
