#!/usr/bin/env node
// Verifies the suite against the real Codex CLI without a model or an API key, in throwaway
// homes and projects:
//
// 1. Skills installed with `npx skills add -a codex` load: `skills/list` over `codex app-server`
//    returns every skill with its description, and the model-visible prompt lists them.
// 2. The repository works as a Codex plugin: a marketplace add and a plugin add expose the skills
//    under the plugin namespace and register the Stop hook from hooks/hooks.json.
// 3. A project `.codex/hooks.json` pointing at the installed guard hook is discovered.
// 4. The guard hook blocks a Codex-shaped Stop payload on weakened tests (exit 2 with a
//    non-empty stderr, which Codex turns into a continuation prompt) and lets the second stop through.
// 5. The bundled scripts behave inside Codex's sandbox (read-only and workspace-write).
//
//   node scripts/codex-check.mjs            # uses CODEX_BIN, else npx @openai/codex@<pinned>
//
// Needs network access to the npm registry the first time.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CODEX_VERSION = "0.162.1";
const SKILLS = readdirSync(join(ROOT, "skills")).filter(function hasSkill(name) {
	return existsSync(join(ROOT, "skills", name, "SKILL.md"));
});
const work = mkdtempSync(join(tmpdir(), "codex-check-"));
let failures = 0;

/**
 * Record one check.
 *
 * @param {boolean} ok - Whether it passed.
 * @param {string} message - What was checked.
 */
function check(ok, message) {
	console.log(`${ok ? "ok  " : "FAIL"}  ${message}`);
	if (!ok) failures += 1;
}

/**
 * The Codex command: CODEX_BIN, else a pinned npx install.
 *
 * @returns {string[]} Command and leading arguments.
 */
function codexCommand() {
	return process.env.CODEX_BIN ? [process.env.CODEX_BIN] : ["npx", "-y", `@openai/codex@${CODEX_VERSION}`];
}

/**
 * A fresh, isolated home with an empty CODEX_HOME.
 *
 * @param {string} name - Folder name.
 * @returns {NodeJS.ProcessEnv} Environment for Codex and the skills CLI.
 */
function isolatedEnv(name) {
	const home = join(work, name, "home");

	mkdirSync(join(home, ".codex"), { recursive: true });

	return { ...process.env, HOME: home, CODEX_HOME: join(home, ".codex"), DO_NOT_TRACK: "1", DISABLE_TELEMETRY: "1", NO_COLOR: "1" };
}

/**
 * A fresh git repository to act as the user's project.
 *
 * @param {string} name - Folder name.
 * @returns {string} Project directory.
 */
function project(name) {
	const dir = join(work, name, "project");

	mkdirSync(dir, { recursive: true });
	execFileSync("git", ["init", "-q"], { cwd: dir });

	return dir;
}

/**
 * Run Codex and return its standard output.
 *
 * @param {string[]} args - Codex arguments.
 * @param {{ cwd: string, env: NodeJS.ProcessEnv }} options - Working directory and environment.
 * @returns {string} Standard output.
 */
function codex(args, options) {
	const [command, ...lead] = codexCommand();

	return execFileSync(command, [...lead, ...args], { ...options, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * Ask a `codex app-server` for some JSON-RPC methods after the initialize handshake.
 *
 * @param {Array<{ method: string, params: unknown }>} requests - Requests to send in order.
 * @param {{ cwd: string, env: NodeJS.ProcessEnv }} options - Working directory and environment.
 * @returns {Promise<unknown[]>} Results, in request order.
 */
function appServer(requests, options) {
	const [command, ...lead] = codexCommand();

	return new Promise(function talk(done, fail) {
		const server = spawn(command, [...lead, "app-server"], { ...options, stdio: ["pipe", "pipe", "pipe"] });
		const results = new Map();
		let buffer = "";
		const timer = setTimeout(function timeout() {
			server.kill("SIGKILL");
			fail(new Error("codex app-server did not answer within 60 s"));
		}, 60_000);

		/**
		 * Send one JSON-RPC message.
		 *
		 * @param {Record<string, unknown>} message - The message.
		 */
		function send(message) {
			server.stdin.write(`${JSON.stringify(message)}\n`);
		}

		server.stdout.on("data", function receive(chunk) {
			buffer += chunk;

			for (let newline = buffer.indexOf("\n"); newline !== -1; newline = buffer.indexOf("\n")) {
				const line = buffer.slice(0, newline).trim();

				buffer = buffer.slice(newline + 1);
				if (!line.startsWith("{")) continue;

				const message = JSON.parse(line);

				if (message.id === 0 && message.result) {
					send({ method: "initialized" });
					requests.forEach(function request(entry, index) {
						send({ id: index + 1, method: entry.method, params: entry.params });
					});
				} else if (typeof message.id === "number" && message.id > 0) {
					results.set(message.id, message.error ? { error: message.error } : message.result);

					if (results.size === requests.length) {
						clearTimeout(timer);
						server.kill("SIGTERM");
						done(
							requests.map(function inOrder(_, index) {
								return results.get(index + 1);
							}),
						);
					}
				}
			}
		});
		server.on("error", fail);
		send({ id: 0, method: "initialize", params: { clientInfo: { name: "test-skills-check", title: "test-skills check", version: "1.0.0" } } });
	});
}

/**
 * Copy the repository's tracked and unignored files, like a git clone of the working tree.
 *
 * @returns {string} The copy.
 */
function repositoryCopy() {
	const copy = join(work, "source");
	const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);

	for (const file of files) {
		if (!existsSync(join(ROOT, file))) continue;
		mkdirSync(dirname(join(copy, file)), { recursive: true });
		cpSync(join(ROOT, file), join(copy, file));
	}

	execFileSync("git", ["init", "-q"], { cwd: copy });
	execFileSync("git", ["add", "-A"], { cwd: copy });
	execFileSync("git", ["-c", "user.name=check", "-c", "user.email=check@example.com", "commit", "-qm", "copy"], { cwd: copy });

	return copy;
}

/**
 * Skill names in a skills/list result for one working directory.
 *
 * @param {any} result - skills/list result.
 * @returns {{ names: string[], errors: unknown[], skills: any[] }} Names, errors and raw entries.
 */
function listedSkills(result) {
	const entry = result?.data?.[0] ?? {};
	const skills = entry.skills ?? [];

	return {
		skills,
		errors: entry.errors ?? [],
		names: skills.map(function nameOf(skill) {
			return skill.name;
		}),
	};
}

/**
 * Run the guard hook with a Codex Stop payload.
 *
 * @param {string} hook - Path to guard-hook.mjs.
 * @param {Record<string, unknown>} payload - Stop payload.
 * @returns {{ status: number | null, stderr: string }} Outcome.
 */
function stopHook(hook, payload) {
	const result = spawnSync(process.execPath, [hook], { input: JSON.stringify(payload), encoding: "utf8", cwd: tmpdir() });

	return { status: result.status, stderr: result.stderr };
}

/**
 * Entry point.
 *
 * @returns {Promise<number>} Exit code.
 */
async function main() {
	const source = repositoryCopy();

	console.log(`codex ${codex(["--version"], { cwd: work, env: isolatedEnv("version") }).trim()} - ${SKILLS.length} skills`);

	// 1. npx skills install for Codex.
	{
		const env = isolatedEnv("npx");
		const dir = project("npx");

		execFileSync("npx", ["-y", "skills@1", "add", source, "-a", "codex", "--skill", "*", "-y", "--copy"], { cwd: dir, env, stdio: "ignore" });

		const installed = existsSync(join(dir, ".agents", "skills")) ? readdirSync(join(dir, ".agents", "skills")) : [];

		check(
			SKILLS.every(function present(name) {
				return installed.includes(name);
			}),
			`npx skills -a codex installs every skill into .agents/skills (${installed.length})`,
		);

		const [list] = await appServer([{ method: "skills/list", params: { cwds: [dir], forceReload: true } }], { cwd: dir, env });
		const { names, errors, skills } = listedSkills(list);

		check(
			SKILLS.every(function loaded(name) {
				return names.includes(name);
			}),
			`skills/list loads every skill (${
				names.filter(function ours(name) {
					return name.startsWith("test-");
				}).length
			} test-* skills)`,
		);
		check(errors.length === 0, `skills/list reports no load errors${errors.length ? `: ${JSON.stringify(errors).slice(0, 300)}` : ""}`);
		check(
			skills
				.filter(function ours(skill) {
					return skill.name.startsWith("test-");
				})
				.every(function described(skill) {
					return typeof skill.description === "string" && skill.description.length > 40;
				}),
			"every skill carries its description",
		);
		check(
			skills
				.filter(function ours(skill) {
					return skill.name.startsWith("test-");
				})
				.every(function withInterface(skill) {
					return skill.interface?.displayName;
				}),
			"every skill carries interface metadata from agents/openai.yaml",
		);

		const prompt = codex(["debug", "prompt-input", "write tests"], { cwd: dir, env });

		check(
			SKILLS.every(function inPrompt(name) {
				return prompt.includes(`- ${name}: `);
			}),
			"the model-visible prompt lists every skill",
		);

		// 3. Project hooks.json pointing at the installed guard hook. Codex reads project config,
		// hooks included, only for trusted projects.
		writeFileSync(join(env.CODEX_HOME, "config.toml"), `[projects.${JSON.stringify(dir)}]\ntrust_level = "trusted"\n`);
		mkdirSync(join(dir, ".codex"), { recursive: true });
		writeFileSync(
			join(dir, ".codex", "hooks.json"),
			JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "node .agents/skills/test-guard/scripts/guard-hook.mjs" }] }] } }),
		);

		const [hooks] = await appServer([{ method: "hooks/list", params: { cwds: [dir] } }], { cwd: dir, env });
		const entry = hooks?.data?.[0] ?? {};
		const stop = (entry.hooks ?? []).filter(function isGuard(hook) {
			return JSON.stringify(hook).includes("guard-hook.mjs");
		});

		check(
			stop.length > 0 || (entry.warnings ?? []).length > 0,
			`a project .codex/hooks.json Stop hook is discovered (trust: ${stop[0]?.trustStatus ?? "?"})`,
		);
	}

	// 2. The repository as a Codex plugin.
	{
		const env = isolatedEnv("plugin");
		const dir = project("plugin");

		codex(["plugin", "marketplace", "add", source], { cwd: dir, env });
		codex(["plugin", "add", "test-skills@test-skills"], { cwd: dir, env });

		const listing = codex(["plugin", "list"], { cwd: dir, env });

		check(/test-skills@test-skills\s+installed, enabled/u.test(listing), "codex plugin add installs and enables test-skills@test-skills");

		const [skills, hooks] = await appServer(
			[
				{ method: "skills/list", params: { cwds: [dir], forceReload: true } },
				{ method: "hooks/list", params: { cwds: [dir] } },
			],
			{ cwd: dir, env },
		);
		const { names } = listedSkills(skills);

		check(
			SKILLS.every(function namespaced(name) {
				return names.includes(`test-skills:${name}`);
			}),
			"the plugin exposes every skill as test-skills:<name>",
		);

		const pluginHooks = (hooks?.data?.[0]?.hooks ?? []).filter(function fromPlugin(hook) {
			return JSON.stringify(hook).includes("guard-hook.mjs");
		});

		check(
			pluginHooks.length === 1,
			`the plugin registers one Stop hook from hooks/hooks.json (trust: ${pluginHooks[0]?.trustStatus ?? "?"}, enabled: ${pluginHooks[0]?.enabled ?? "?"})`,
		);
	}

	// 4. The guard hook against a Codex-shaped Stop payload.
	{
		const repo = join(work, "weakened");
		const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

		mkdirSync(repo, { recursive: true });
		writeFileSync(
			join(repo, "cart.test.js"),
			'test("a", () => {\n\texpect(total([1])).toBe(1);\n});\ntest("b", () => {\n\texpect(total([])).toBe(0);\n});\n',
		);
		execFileSync("git", ["init", "-q"], { cwd: repo, env });
		execFileSync("git", ["add", "-A"], { cwd: repo, env });
		execFileSync("git", ["commit", "-qm", "base"], { cwd: repo, env });
		writeFileSync(
			join(repo, "cart.test.js"),
			'test("a", () => {\n\texpect(total([1])).toBe(1);\n});\ntest.skip("b", () => {\n\texpect(total([])).toBe(0);\n});\n',
		);

		const payload = {
			session_id: "00000000-0000-0000-0000-000000000000",
			turn_id: "turn-1",
			transcript_path: null,
			cwd: repo,
			hook_event_name: "Stop",
			model: "test",
			permission_mode: "default",
			stop_hook_active: false,
			last_assistant_message: "Done.",
		};
		const hook = join(source, "skills", "test-guard", "scripts", "guard-hook.mjs");
		const first = stopHook(hook, payload);
		const second = stopHook(hook, { ...payload, stop_hook_active: true });

		check(
			first.status === 2 && first.stderr.trim().length > 0,
			`guard hook blocks a weakened Stop with exit 2 and a continuation message (${first.stderr.split("\n")[1] ?? ""})`,
		);
		check(second.status === 0, "guard hook lets the second stop through");
	}

	// 5. The bundled scripts inside Codex's sandbox: read-only for the readers, workspace-write for
	// the ones that edit files or run Bombadil's terminal driver.
	{
		const env = isolatedEnv("sandbox");
		// Output goes through a file: Node captures child output over socket pairs, which the
		// sandbox's network restrictions block, so a piped capture would come back empty.
		const sandbox = function inSandbox(mode, args) {
			const [command, ...lead] = codexCommand();
			const log = join(work, "sandbox", `run-${Date.now()}-${Math.random().toString(36).slice(2)}.log`);
			const result = spawnSync(
				"sh",
				["-c", '"$@" > "$SANDBOX_LOG" 2>&1', "sh", command, ...lead, "sandbox", "-c", `sandbox_mode="${mode}"`, "--", ...args],
				{
					cwd: source,
					env: { ...env, SANDBOX_LOG: log },
					encoding: "utf8",
				},
			);

			return { status: result.status, output: existsSync(log) ? readFileSync(log, "utf8") : "" };
		};
		const audit = sandbox("read-only", ["node", "skills/test-audit/scripts/audit-tests.mjs", "evals/suites"]);
		const guard = sandbox("read-only", ["node", "skills/test-guard/scripts/guard-tests.mjs", "--base", "HEAD"]);
		const before = readFileSync(join(source, "evals/fixtures/pricing/pricing.mjs"), "utf8");
		const mutateReadOnly = sandbox("read-only", [
			"node",
			"skills/test-audit/scripts/mutate.mjs",
			"--file",
			"evals/fixtures/pricing/pricing.mjs",
			"--max",
			"3",
			"--",
			"node",
			"--test",
			"evals/fixtures/pricing/pricing.test.mjs",
		]);
		const mutate = sandbox("workspace-write", [
			"node",
			"skills/test-audit/scripts/mutate.mjs",
			"--file",
			"evals/fixtures/pricing/pricing.mjs",
			"--max",
			"3",
			"--",
			"node",
			"--test",
			"evals/fixtures/pricing/pricing.test.mjs",
		]);
		const repeat = sandbox("read-only", ["node", "skills/test-flaky/scripts/repeat.mjs", "--runs", "3", "--", "node", "-e", "0"]);

		check(/audit-tests: \d+ files/u.test(audit.output), "audit-tests runs in a read-only sandbox");
		check(/guard-tests vs HEAD: ok/u.test(guard.output), "guard-tests runs in a read-only sandbox (git without network access)");
		check(mutateReadOnly.status === 2 && /Cannot write/u.test(mutateReadOnly.output), "mutate.mjs refuses cleanly in a read-only sandbox");
		check(mutate.status === 0 && /3 mutants/u.test(mutate.output), "mutate.mjs runs in a workspace-write sandbox");
		check(readFileSync(join(source, "evals/fixtures/pricing/pricing.mjs"), "utf8") === before, "mutate.mjs leaves the source as it found it");
		check(repeat.status === 0 && /0\/3 runs failed/u.test(repeat.output), "repeat.mjs measures in a read-only sandbox");

		if (existsSync(join(ROOT, "node_modules", "@antithesishq", "bombadil"))) {
			cpSync(join(ROOT, "node_modules"), join(source, "node_modules"), { recursive: true, verbatimSymlinks: true });

			const bombadil = sandbox("workspace-write", [
				"node",
				"skills/test-explore/assets/bombadil-run.mjs",
				"--terminal",
				"node examples/buggy-cli/todo.mjs",
				"--spec",
				"examples/buggy-cli/bombadil/spec.ts",
				"--keep-going",
				"--time-limit",
				"20s",
				"--",
				"--columns",
				"72",
				"--rows",
				"28",
			]);

			check(bombadil.status === 2, `Bombadil's terminal driver finds the CLI demo bugs in a workspace-write sandbox (exit ${bombadil.status})`);
		} else {
			console.log("skip  Bombadil in the sandbox: run pnpm install first");
		}
	}

	console.log(failures === 0 ? "\nCodex compatibility: all checks passed." : `\nCodex compatibility: ${failures} check(s) failed.`);

	return failures === 0 ? 0 : 1;
}

main()
	.then(function finish(code) {
		process.exitCode = code;
	})
	.catch(function crash(error) {
		console.error(`codex-check: ${error instanceof Error ? error.stack : String(error)}`);
		process.exitCode = 1;
	})
	.finally(function cleanUp() {
		rmSync(work, { recursive: true, force: true });
	});
