#!/usr/bin/env node
// Zero-dependency Bombadil runner: finds the binary and a Chromium, optionally starts the app,
// runs Bombadil under a watchdog, records the setup, applies a finding policy and writes a summary.
//
//   node bombadil-run.mjs --origin http://127.0.0.1:3000/ --spec bombadil/spec.ts
//   node bombadil-run.mjs --start "npm run preview" --origin http://127.0.0.1:4173/ --spec bombadil/spec.ts --time-limit 5m
//   node bombadil-run.mjs --reproduce out/bombadil/spec
//   node bombadil-run.mjs --summarize out/bombadil/spec
//
// Options:
//   --origin <url>          Start URL; exploration stays on its origin
//   --spec <file>           Specification module (.ts or .js); Bombadil's defaults when omitted
//   --time-limit <d>        30s, 5m, 2h (default 3m)
//   --out <dir>             Output folder (default out/bombadil/<spec name>)
//   --keep-going            Report every violation instead of stopping at the first
//   --headed                Show the browser window
//   --width <px> --height <px>
//   --start <command>       Shell command that serves the app; stopped when the run ends
//   --policy <file>         Finding policy JSON (default bombadil/policy.json when present)
//   --external <url>        Attach to a running browser or Electron app's DevTools endpoint
//   --reproduce <dir>       Replay a previous run with its recorded setup
//   --summarize <dir>       Only summarize an existing trace
//   --silence <seconds>     Watchdog: stop after this long without output (default 120)
//   -- <args>               Passed to Bombadil unchanged
//
// Exit codes match Bombadil: 0 clean (or only recorded findings), 2 a finding failed the run, 1 error.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Bombadil's exit status when a property was violated. */
export const VIOLATED = 2;

/**
 * Parse command-line arguments.
 *
 * @param {string[]} argv - Arguments after the script path.
 * @returns {Record<string, string | boolean | string[]>} Options, with `passthrough` holding arguments after `--`.
 */
export function parseArgs(argv) {
	const options = { passthrough: [] };
	const flags = new Set(["keep-going", "headed"]);

	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];

		if (argument === "--") {
			options.passthrough = argv.slice(index + 1);
			break;
		}

		if (!argument.startsWith("--")) throw new Error(`Unexpected argument ${argument}`);

		const name = argument.slice(2);

		if (flags.has(name)) {
			options[name] = true;
		} else {
			const value = argv[index + 1];

			if (value === undefined) throw new Error(`${argument} needs a value`);

			options[name] = value;
			index += 1;
		}
	}

	return options;
}

/**
 * Find the Bombadil binary: the npm package's platform binary (spawned directly, because the npm
 * launcher does not forward signals), else `bombadil` on PATH.
 *
 * @param {string} from - Directory to start searching upward for node_modules.
 * @returns {string} Executable path or command name.
 */
export function locateBombadil(from) {
	const name = `bombadil-${process.platform}-${process.arch}`;

	for (let directory = resolve(from); ; directory = dirname(directory)) {
		const packageDir = join(directory, "node_modules", "@antithesishq", "bombadil");

		if (existsSync(packageDir)) {
			const binary = join(realpathSync(packageDir), "binaries", name);

			if (existsSync(binary)) return binary;
			throw new Error(`@antithesishq/bombadil has no binary for ${process.platform}-${process.arch}; use the Docker image or a Linux/macOS machine`);
		}

		if (dirname(directory) === directory) return "bombadil";
	}
}

/**
 * Find a Chromium or Chrome executable for Bombadil, which reads the CHROME variable before
 * searching PATH. Playwright's downloaded browsers are a common source in CI and containers.
 *
 * @param {NodeJS.ProcessEnv} env - Environment.
 * @returns {string | undefined} Executable path, or undefined to let Bombadil search.
 */
export function locateChrome(env) {
	if (env.CHROME) return env.CHROME;

	const candidates = [
		"/usr/bin/google-chrome-stable",
		"/usr/bin/google-chrome",
		"/usr/bin/chromium-browser",
		"/usr/bin/chromium",
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		"/Applications/Chromium.app/Contents/MacOS/Chromium",
	];

	if (candidates.some(existsSync)) return undefined;

	const roots = [env.PLAYWRIGHT_BROWSERS_PATH, join(homedir(), ".cache", "ms-playwright"), join(homedir(), "Library", "Caches", "ms-playwright")];

	for (const root of roots) {
		if (!root || !existsSync(root)) continue;

		const builds = readdirSync(root)
			.filter(function isChromium(entry) {
				return /^chromium-\d+$/u.test(entry);
			})
			.sort()
			.reverse();

		for (const build of builds) {
			for (const relative of ["chrome-linux/chrome", "chrome-linux64/chrome", "chrome-mac/Chromium.app/Contents/MacOS/Chromium", "chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium"]) {
				const executable = join(root, build, relative);

				if (existsSync(executable)) return executable;
			}
		}
	}

	return undefined;
}

/**
 * Read a JSONL trace written by Bombadil.
 *
 * @param {string} output - Output folder holding trace.jsonl.
 * @returns {Array<Record<string, unknown>>} One entry per recorded state.
 */
export function readTrace(output) {
	const file = join(output, "trace.jsonl");

	if (!existsSync(file)) return [];

	return readFileSync(file, "utf8")
		.split("\n")
		.filter(Boolean)
		.map(function parse(line) {
			return JSON.parse(line);
		});
}

/**
 * Describe an action from the trace in a few words.
 *
 * @param {unknown} action - The recorded action.
 * @returns {string} Short description.
 */
export function describeAction(action) {
	if (action === null || action === undefined) return "start";
	if (typeof action === "string") return action;

	const [kind, detail] = Object.entries(action)[0] ?? ["?", {}];
	const target = detail?.fingerprint;
	const label = target ? target.test_id ?? target.id ?? target.accessible_name ?? target.text_content ?? target.tag : undefined;

	if (kind === "TypeText") return `type ${JSON.stringify(String(detail.text).slice(0, 60))}`;
	if (kind === "PressKey") return `key ${detail.code}`;

	return label ? `${kind} ${JSON.stringify(String(label).slice(0, 40))}` : kind;
}

/**
 * Group violations by property: how often, when first, and the action that led there.
 *
 * @param {Array<Record<string, any>>} trace - Parsed trace.
 * @returns {Array<{ property: string, count: number, firstStep: number, firstAction: string, url: string }>} Findings, most frequent first.
 */
export function summarizeTrace(trace) {
	const findings = new Map();

	trace.forEach(function collect(entry, step) {
		for (const violation of entry.violations ?? []) {
			const known = findings.get(violation.name);

			if (known) known.count += 1;
			else findings.set(violation.name, { property: violation.name, count: 1, firstStep: step, firstAction: describeAction(entry.action), url: entry.state?.url ?? "" });
		}
	});

	return [...findings.values()].sort(function byCount(a, b) {
		return b.count - a.count;
	});
}

/**
 * Decide what each finding does under a policy: `stop` fails the run, `record` lists it,
 * `ignore` drops it. Known findings are recorded until their `until` date (YYYY-MM-DD).
 *
 * @param {Array<{ property: string }>} findings - Findings from {@link summarizeTrace}.
 * @param {{ default?: string, properties?: Record<string, string>, known?: Array<{ property: string, until: string, reason?: string }> }} policy - Finding policy.
 * @param {string} today - Current date as YYYY-MM-DD.
 * @returns {Array<{ property: string, verdict: "stop" | "record" | "ignore", reason?: string }>} Verdicts.
 */
export function applyPolicy(findings, policy, today) {
	return findings.map(function decide(finding) {
		const known = (policy.known ?? []).find(function matches(entry) {
			return entry.property === finding.property && entry.until >= today;
		});

		if (known) return { ...finding, verdict: "record", reason: `known until ${known.until}: ${known.reason ?? ""}`.trim() };

		const verdict = policy.properties?.[finding.property] ?? policy.default ?? "stop";

		return { ...finding, verdict };
	});
}

/**
 * Render a Markdown summary of a run.
 *
 * @param {{ setup: Record<string, unknown>, states: number, verdicts: ReturnType<typeof applyPolicy>, reproduce: string }} run - Run data.
 * @returns {string} Markdown.
 */
export function renderSummary(run) {
	const lines = [`# Bombadil run`, "", `- Origin: ${run.setup.origin}`, `- Spec: ${run.setup.spec ?? "defaults"}`, `- States: ${run.states}`, ""];
	const shown = run.verdicts.filter(function visible(finding) {
		return finding.verdict !== "ignore";
	});

	if (shown.length === 0) {
		lines.push("No findings.");
	} else {
		lines.push("| Property | Verdict | Count | First step | After |", "| --- | --- | ---: | ---: | --- |");

		for (const finding of shown) {
			lines.push(`| ${finding.property} | ${finding.verdict}${finding.reason ? ` (${finding.reason})` : ""} | ${finding.count} | ${finding.firstStep} | ${finding.firstAction.replaceAll("|", "\\|")} |`);
		}
	}

	lines.push("", "Reproduce:", "", "```sh", run.reproduce, "```", "");

	return lines.join("\n");
}

/**
 * Start the app with a shell command and wait until the origin answers.
 *
 * @param {string} command - Shell command.
 * @param {string} origin - URL to poll.
 * @param {number} timeoutMs - Maximum wait.
 * @returns {Promise<import("node:child_process").ChildProcess>} The running server.
 */
async function startApp(command, origin, timeoutMs) {
	if (await answers(origin)) throw new Error(`${origin} already answers before --start ran; stop whatever listens there, or drop --start`);

	const server = spawn(command, { shell: true, stdio: ["ignore", "inherit", "inherit"], detached: process.platform !== "win32" });
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		if (server.exitCode !== null) throw new Error(`--start command exited with ${server.exitCode}`);

		if (await answers(origin)) return server;

		await new Promise(function pause(done) {
			setTimeout(done, 250);
		});
	}

	stopProcess(server);
	throw new Error(`${origin} did not answer within ${timeoutMs / 1000}s`);
}

/**
 * Whether something serves the origin.
 *
 * @param {string} origin - URL to request.
 * @returns {Promise<boolean>} True on any response below 500.
 */
async function answers(origin) {
	try {
		const response = await fetch(origin, { signal: AbortSignal.timeout(2_000) });

		return response.status < 500;
	} catch {
		return false;
	}
}

/**
 * Stop a process group started by {@link startApp}.
 *
 * @param {import("node:child_process").ChildProcess} child - Process to stop.
 */
function stopProcess(child) {
	if (child.exitCode !== null) return;

	try {
		if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
		else child.kill("SIGTERM");
	} catch {
		child.kill("SIGTERM");
	}
}

/**
 * Run Bombadil with a watchdog: SIGINT after `silenceMs` without output, SIGKILL 15 seconds later.
 * A hung run keeps the trace it wrote so far.
 *
 * @param {string} binary - Bombadil executable.
 * @param {string[]} args - Arguments.
 * @param {NodeJS.ProcessEnv} env - Environment.
 * @param {number} silenceMs - Allowed silence.
 * @returns {Promise<{ code: number, log: string, stalled: boolean }>} Exit code, captured output and whether the watchdog fired.
 */
function runBombadil(binary, args, env, silenceMs) {
	return new Promise(function execute(done) {
		const child = spawn(binary, args, { env, stdio: ["ignore", "pipe", "pipe"] });
		let log = "";
		let timer;
		let stalled = false;

		/**
		 * Restart the silence timer.
		 */
		function arm() {
			clearTimeout(timer);
			timer = setTimeout(function stall() {
				stalled = true;
				process.stderr.write(`\nwatchdog: no output for ${silenceMs / 1000}s, stopping Bombadil\n`);
				child.kill("SIGINT");
				setTimeout(function force() {
					child.kill("SIGKILL");
				}, 15_000).unref();
			}, silenceMs);
		}

		/**
		 * Forward and capture output.
		 *
		 * @param {Buffer} chunk - Output bytes.
		 */
		function forward(chunk) {
			const text = chunk.toString();

			log += text;
			process.stdout.write(text.replaceAll(/^\s+\d+: <unknown>\n/gmu, ""));
			arm();
		}

		child.stdout.on("data", forward);
		child.stderr.on("data", forward);
		child.on("close", function closed(code) {
			clearTimeout(timer);
			done({ code: code ?? 1, log, stalled });
		});
		arm();
	});
}

/**
 * Entry point.
 *
 * @param {string[]} argv - Arguments after the script path.
 * @returns {Promise<number>} Exit code.
 */
async function main(argv) {
	const options = parseArgs(argv);

	if (options.summarize) {
		const trace = readTrace(String(options.summarize));
		const setupFile = join(String(options.summarize), "run.json");
		const setup = existsSync(setupFile) ? JSON.parse(readFileSync(setupFile, "utf8")) : { origin: "?" };

		console.log(renderSummary({ setup, states: trace.length, verdicts: applyPolicy(summarizeTrace(trace), loadPolicy(setup.policy), today()), reproduce: "" }));
		return 0;
	}

	const recorded = options.reproduce ? JSON.parse(readFileSync(join(String(options.reproduce), "run.json"), "utf8")) : {};
	const setup = { ...recorded, ...withoutRunOnly(options) };

	if (!setup.origin) throw new Error("--origin is required");

	const spec = setup.spec ? resolve(String(setup.spec)) : undefined;
	const original = options.reproduce ? resolve(String(options.reproduce)) : undefined;
	// A replay writes next to the original run, which Bombadil refuses to overwrite.
	const output = original ? join(original, "replay") : resolve(String(setup.out ?? join("out", "bombadil", spec ? basename(spec, extname(spec)) : "defaults")));
	const binary = locateBombadil(process.cwd());
	const env = { ...process.env };
	const chrome = locateChrome(env);

	if (chrome) env.CHROME = chrome;

	const target = setup.external ? ["browser", "test-external", setup.origin, ...(spec ? [spec] : []), "--remote-debugger", setup.external] : ["browser", "test", setup.origin, ...(spec ? [spec] : [])];
	const shared = [
		...target,
		"--output-path",
		output,
		"--output-path-overwrite",
		...(setup.external || setup.headed ? [] : ["--headless"]),
		...(setup.width ? ["--width", String(setup.width)] : []),
		...(setup.height ? ["--height", String(setup.height)] : []),
		...(process.env.BOMBADIL_NO_SANDBOX === "1" || (process.getuid?.() === 0 && !setup.external) ? ["--no-sandbox"] : []),
		...(setup.passthrough ?? []),
	];
	const args = original ? [...shared, "--reproduce", original] : [...shared, "--time-limit", String(setup["time-limit"] ?? "3m"), ...(setup["keep-going"] ? [] : ["--exit-on-violation"])];
	const server = setup.start ? await startApp(String(setup.start), String(setup.origin), 60_000) : undefined;

	try {
		mkdirSync(output, { recursive: true });

		if (!options.reproduce) writeFileSync(join(output, "run.json"), `${JSON.stringify({ ...setup, startedAt: new Date().toISOString() }, null, "\t")}\n`);

		let result = await runBombadil(binary, args, env, Number(setup.silence ?? 120) * 1000);

		// Older Chromium builds reject Bombadil's default local-network permissions.
		if (result.code === 1 && /Invalid PermissionDescriptor/u.test(result.log) && !args.includes("--chrome-grant-permissions")) {
			process.stderr.write("\nThis Chromium rejects the default permissions; retrying with --chrome-grant-permissions geolocation\n");
			result = await runBombadil(binary, [...args, "--chrome-grant-permissions", "geolocation"], env, Number(setup.silence ?? 120) * 1000);

			// Record the workaround so replays start the browser the same way.
			if (!original) {
				setup.passthrough = [...(setup.passthrough ?? []), "--chrome-grant-permissions", "geolocation"];
				writeFileSync(join(output, "run.json"), `${JSON.stringify({ ...setup, startedAt: new Date().toISOString() }, null, "\t")}\n`);
			}
		}

		const trace = readTrace(output);
		const verdicts = applyPolicy(summarizeTrace(trace), loadPolicy(setup.policy), today());
		const reproduce = `node ${relativeScript()} --reproduce ${original ?? output}`;

		if (/reproduction and original test diverged/u.test(result.log)) {
			process.stderr.write("\nThe replay diverged from the original run: check settling, stable test ids and seeded data before blaming the app.\n");
		}
		const summary = renderSummary({ setup, states: trace.length, verdicts, reproduce });

		writeFileSync(join(output, "summary.md"), summary);
		console.log(`\n${summary}`);

		const failing = verdicts.some(function fails(finding) {
			return finding.verdict === "stop";
		});

		// A stalled run keeps the findings it recorded before the watchdog stopped it.
		if (result.stalled) {
			process.stderr.write("The watchdog stopped a stalled run; findings recorded before the stall are kept.\n");
			return failing ? VIOLATED : 1;
		}

		if (result.code !== 0 && result.code !== VIOLATED) return 1;

		return failing ? VIOLATED : 0;
	} finally {
		if (server) stopProcess(server);
	}
}

/**
 * Drop options that describe this invocation rather than the setup to replay.
 *
 * @param {Record<string, unknown>} options - Parsed options.
 * @returns {Record<string, unknown>} Setup fields.
 */
function withoutRunOnly(options) {
	const { reproduce: _reproduce, summarize: _summarize, ...setup } = options;

	return setup;
}

/**
 * Load a finding policy, defaulting to bombadil/policy.json when present.
 *
 * @param {unknown} file - Policy path from the options.
 * @returns {Record<string, unknown>} The policy.
 */
function loadPolicy(file) {
	const path = file ? String(file) : join("bombadil", "policy.json");

	return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { default: "stop" };
}

/**
 * Today's date as YYYY-MM-DD.
 *
 * @returns {string} The date.
 */
function today() {
	return new Date().toISOString().slice(0, 10);
}

/**
 * This script's path relative to the working directory, for printed commands.
 *
 * @returns {string} Path.
 */
function relativeScript() {
	const script = process.argv[1] ?? "bombadil-run.mjs";

	return script.startsWith(process.cwd()) ? script.slice(process.cwd().length + 1) : script;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	main(process.argv.slice(2)).then(
		function finish(code) {
			process.exitCode = code;
		},
		function fail(error) {
			console.error(`bombadil-run: ${error instanceof Error ? error.message : String(error)}`);
			process.exitCode = 1;
		},
	);
}
