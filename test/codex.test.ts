import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { validateCodexManifests } from "../src/core/distribution.js";
import { discoverSkills, type Issue } from "../src/core/skill.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skills = discoverSkills(path.join(ROOT, "skills"));
const temporary: string[] = [];

/**
 * Rule ids of issues.
 *
 * @param issues - Validation issues.
 * @returns Rule ids, sorted.
 */
function rules(issues: Issue[]): string[] {
	return issues
		.map(function toRule(issue) {
			return issue.rule;
		})
		.sort();
}

/**
 * A throwaway repository with one skill and the given Codex files.
 *
 * @param files - Paths and contents relative to the repository root.
 * @returns Repository root.
 */
function repository(files: Record<string, string>): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-manifest-"));

	temporary.push(root);

	const all: Record<string, string> = {
		"skills/test-sample/SKILL.md":
			'---\nname: test-sample\ndescription: "Sample skill for manifest tests. Use when testing. Hands off to `test-sample`."\nmetadata:\n  stage: author\n---\n\n# Sample\n',
		"hooks/hooks.json": "{}",
		...files,
	};

	for (const [file, content] of Object.entries(all)) {
		fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
		fs.writeFileSync(path.join(root, file), content);
	}

	return root;
}

afterEach(function cleanUp() {
	for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("Codex adapters in this repository", function repositorySuite() {
	test("every skill ships agents/openai.yaml", function everySkill() {
		const missing = skills
			.filter(function lacks(skill) {
				return !fs.existsSync(path.join(skill.dir, "agents", "openai.yaml"));
			})
			.map(function toName(skill) {
				return skill.name;
			});

		expect(missing).toEqual([]);
	});

	test("the plugin manifest, marketplace and interfaces validate", function clean() {
		const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;

		expect(validateCodexManifests(ROOT, skills, version)).toEqual([]);
	});
});

describe("validateCodexManifests", function validateSuite() {
	const manifest = JSON.stringify({ name: "test-skills", version: "1.0.0", skills: "./skills/", hooks: "./hooks/hooks.json" });
	const marketplace = JSON.stringify({ name: "test-skills", plugins: [{ name: "test-skills", source: { source: "local", path: "./" } }] });

	test("accepts a consistent setup", function consistent() {
		const root = repository({
			".codex-plugin/plugin.json": manifest,
			".agents/plugins/marketplace.json": marketplace,
			"skills/test-sample/agents/openai.yaml": 'interface:\n  display_name: "Sample"\n  default_prompt: "Use $test-sample now."\n',
		});

		expect(validateCodexManifests(root, discoverSkills(path.join(root, "skills")), "1.0.0")).toEqual([]);
	});

	test("reports version drift, bad paths and a missing marketplace entry", function drift() {
		const root = repository({
			".codex-plugin/plugin.json": JSON.stringify({ name: "test-skills", version: "0.9.0", skills: "skills/", hooks: "./missing.json" }),
		});

		expect(rules(validateCodexManifests(root, discoverSkills(path.join(root, "skills")), "1.0.0"))).toEqual([
			"codex.marketplace",
			"codex.plugin.path",
			"codex.plugin.path",
			"codex.plugin.version",
		]);
	});

	test.each([
		["codex.interface.field", 'interface:\n  title: "Sample"\n'],
		["codex.interface.value", `interface:\n  display_name: "${"x".repeat(65)}"\n`],
		["codex.interface.prompt", 'interface:\n  default_prompt: "Do the thing."\n'],
		["codex.interface.shape", "name: sample\n"],
		["codex.interface.yaml", "interface: [\n"],
	])("reports %s in agents/openai.yaml", function interfaceRule(rule, yaml) {
		const root = repository({ "skills/test-sample/agents/openai.yaml": yaml });

		expect(rules(validateCodexManifests(root, discoverSkills(path.join(root, "skills")), "1.0.0"))).toContain(rule);
	});
});
