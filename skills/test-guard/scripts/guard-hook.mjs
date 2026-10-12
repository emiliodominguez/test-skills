#!/usr/bin/env node
// Hook entry for guard-tests.mjs: run it when an agent tries to finish, or before a commit, and
// block once if the change weakened tests.
//
//   node guard-hook.mjs                  # agent stop hook: reads the hook payload on stdin
//   node guard-hook.mjs --base HEAD      # git pre-commit: only uncommitted changes
//
// Behavior:
// - Weakened tests (guard errors): print the findings to stderr and exit 2, which blocks an agent's
//   stop hook (the agent gets the message and continues) and fails a git hook.
// - A payload with "stop_hook_active": true means the agent is already continuing because of a
//   stop hook: exit 0, so a justified change is not blocked forever.
// - Not a git repository, or any guard error: exit 0 and stay out of the way.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Parse an optional hook payload.
 *
 * @param {string} text - Standard input.
 * @returns {{ cwd?: string, stop_hook_active?: boolean }} The payload, or an empty object.
 */
export function parsePayload(text) {
	try {
		const payload = JSON.parse(text);

		return payload && typeof payload === "object" ? payload : {};
	} catch {
		return {};
	}
}

/**
 * Build the message an agent or a person sees when the guard blocks.
 *
 * @param {Array<{ level: string, rule: string, file: string, detail: string }>} findings - Guard findings.
 * @returns {string} Message.
 */
export function blockMessage(findings) {
	const errors = findings.filter(function isError(finding) {
		return finding.level === "error";
	});
	const lines = errors.map(function describe(finding) {
		return `- ${finding.rule} in ${finding.file}: ${finding.detail}`;
	});

	return [
		"test-guard: this change weakens tests.",
		...lines,
		"Restore each one, or keep it and say why in your summary: the behavior was removed, the case moved (name where), or the requirement changed.",
	].join("\n");
}

/**
 * Entry point.
 *
 * @param {string[]} argv - Arguments after the script path.
 * @returns {number} Exit code.
 */
function main(argv) {
	const payload = process.stdin.isTTY ? {} : parsePayload(readFileSync(0, "utf8"));

	if (payload.stop_hook_active === true) return 0;

	const guard = join(dirname(fileURLToPath(import.meta.url)), "guard-tests.mjs");
	const result = spawnSync(process.execPath, [guard, "--json", ...argv], { cwd: payload.cwd ?? process.cwd(), encoding: "utf8" });

	if (result.status !== 1) return 0;

	let findings;

	try {
		findings = JSON.parse(result.stdout).findings;
	} catch {
		return 0;
	}

	process.stderr.write(`${blockMessage(findings)}\n`);

	return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
