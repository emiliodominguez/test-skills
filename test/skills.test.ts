import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { validateDistribution } from "../src/core/distribution.js";
import {
	discoverSkills,
	extractSkillRefs,
	localLinks,
	parseFrontmatter,
	validateCorpus,
	validateSkill,
	type Issue,
	type Skill,
} from "../src/core/skill.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skills = discoverSkills(path.join(ROOT, "skills"));
const temporary: string[] = [];

/**
 * Read a JSON file from the repository.
 *
 * @param file - Path relative to the repository root.
 * @returns The parsed value.
 */
function readJson<T>(file: string): T {
	return JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8")) as T;
}

/**
 * Write a throwaway skill and load it.
 *
 * @param name - Directory name.
 * @param content - SKILL.md contents.
 * @param references - Extra files under `references/`, keyed by file name.
 * @returns The loaded skill.
 */
function fixture(name: string, content: string, references: Record<string, string> = {}): Skill {
	const base = fs.mkdtempSync(path.join(os.tmpdir(), "test-skills-"));
	const dir = path.join(base, name);

	temporary.push(base);
	fs.mkdirSync(path.join(dir, "references"), { recursive: true });
	fs.writeFileSync(path.join(dir, "SKILL.md"), content);

	for (const [file, text] of Object.entries(references)) fs.writeFileSync(path.join(dir, "references", file), text);

	return discoverSkills(base)[0]!;
}

/**
 * Rule ids of the issues at a level.
 *
 * @param issues - Validation issues.
 * @param level - Severity to keep.
 * @returns The rule ids.
 */
function rules(issues: Issue[], level: Issue["level"]): string[] {
	return issues
		.filter(function atLevel(issue) {
			return issue.level === level;
		})
		.map(function toRule(issue) {
			return issue.rule;
		});
}

const valid = [
	"---",
	"name: test-sample",
	'description: "A sample skill used by the validator tests. Use when checking rules. Hands off to `test-sample` for nothing else."',
	"metadata:",
	"  stage: author",
	"---",
	"",
	"# Sample",
	"",
	"## Anti-patterns",
	"",
	"- None.",
	"",
	"## Done when",
	"",
	"- Always.",
].join("\n");

afterEach(function cleanUp() {
	for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("the corpus", function corpus() {
	test("has skills", function hasSkills() {
		expect(skills.length).toBeGreaterThan(0);
	});

	test("validates with no errors or warnings", function clean() {
		const issues = [
			...skills.flatMap(function check(skill) {
				return validateSkill(skill);
			}),
			...validateCorpus(skills),
			...validateDistribution(ROOT, skills),
		];

		expect(issues).toEqual([]);
	});

	test("keeps every instruction marker", function markers() {
		const beats = readJson<{ skills: Record<string, string[]> }>("evals/beats.json").skills;
		const missing = skills.flatMap(function missingMarkers(skill) {
			const text = fs.readFileSync(path.join(skill.dir, "SKILL.md"), "utf8").toLowerCase();

			return (beats[skill.name] ?? ["<no markers>"])
				.filter(function absent(marker) {
					return !text.includes(marker);
				})
				.map(function label(marker) {
					return `${skill.name}: ${marker}`;
				});
		});

		expect(missing).toEqual([]);
	});

	test("has four should prompts and three near misses per skill", function triggers() {
		const routing = readJson<{ skills: Record<string, { should: string[]; near: string[] }> }>("evals/triggers.json").skills;
		const wrong = skills
			.filter(function misshapen(skill) {
				const entry = routing[skill.name];

				return entry?.should.length !== 4 || entry.near.length !== 3;
			})
			.map(function toName(skill) {
				return skill.name;
			});

		expect(wrong).toEqual([]);
	});

	test("names no agent host or invocation syntax in skill text", function portable() {
		// "Cursor" is matched case-sensitively: lowercase cursor is a terminal concept, not the agent.
		const hosts = /\b(claude|codex|copilot|gemini|anthropic|openai)\b|(^|\s)\/test-|\$test-/i;
		const caseSensitiveHosts = /\bCursor\b/;
		const offenders = skills
			.filter(function mentionsHost(skill) {
				const text = `${skill.body}\n${skill.supporting}\n${skill.frontmatter.description}`;

				return hosts.test(text) || caseSensitiveHosts.test(text);
			})
			.map(function toName(skill) {
				return skill.name;
			});

		expect(offenders).toEqual([]);
	});
});

describe("validateSkill", function validateSkillSuite() {
	test("accepts a well-formed skill", function wellFormed() {
		expect(validateSkill(fixture("test-sample", valid))).toEqual([]);
	});

	test.each([
		["name.match-dir", "test-other", valid],
		["name.prefix", "sample", valid.replace("name: test-sample", "name: sample")],
		["frontmatter.portable", "test-sample", valid.replace("metadata:", "model: fast\nmetadata:")],
		["metadata.stage", "test-sample", valid.replace("stage: author", "stage: ship")],
		["description.single-line", "test-sample", valid.replace(/description: ".*"/, "description: |\n  one\n  two")],
		["link.missing", "test-sample", `${valid}\n\nRead [this](references/missing.md).`],
		["frontmatter.yaml", "test-sample", valid.replace("stage: author", "stage: [author")],
	])("reports %s", function reports(rule, dir, content) {
		expect(rules(validateSkill(fixture(dir, content)), "error")).toContain(rule);
	});

	test.each([
		["description.handoff", valid.replace("Hands off to `test-sample` for nothing else.", "No handoff here at all, padded out for length.")],
		["structure.done-when", valid.replace("## Done when", "## Finished")],
		["structure.guardrails", valid.replace("## Anti-patterns", "## Notes")],
		["prose.weasel", `${valid}\n\nSimply do it.`],
		["description.thin", valid.replace(/description: ".*"/, 'description: "Short. Hands off to `test-sample`."')],
	])("warns %s", function warns(rule, content) {
		expect(rules(validateSkill(fixture("test-sample", content)), "warn")).toContain(rule);
	});

	test("reports a broken link inside a reference file", function referenceLinks() {
		const skill = fixture("test-sample", valid, { "topic.md": "See [gone](gone.md)." });

		expect(rules(validateSkill(skill), "error")).toContain("link.missing");
	});
});

describe("validateCorpus", function validateCorpusSuite() {
	test("reports an empty corpus", function empty() {
		expect(rules(validateCorpus([]), "error")).toEqual(["corpus.empty"]);
	});

	test("reports a reference to an unknown skill", function dangling() {
		const skill = fixture("test-sample", `${valid}\n\nThen use \`test-missing\`.`);

		expect(rules(validateCorpus([skill]), "error")).toEqual(["reference.dangling"]);
	});
});

describe("helpers", function helpers() {
	test("parseFrontmatter reports a non-mapping", function nonMapping() {
		expect(parseFrontmatter("---\n- a\n---\nbody").error).toBe("frontmatter must be a YAML mapping");
	});

	test("localLinks keeps only relative files", function links() {
		expect(localLinks("[a](references/a.md#x) [b](https://x.dev) [c](#top) [d](/abs.md)")).toEqual(["references/a.md"]);
	});

	test("extractSkillRefs finds backticked family names only", function refs() {
		expect(extractSkillRefs("`test-unit`, `flow-plan`, test-e2e and `test-results/`")).toEqual(["test-unit"]);
	});
});

describe("validateDistribution", function distribution() {
	test("reports unknown profile members and version drift", function drift() {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "test-skills-dist-"));

		temporary.push(root);
		fs.mkdirSync(path.join(root, ".claude-plugin"));
		fs.writeFileSync(path.join(root, "profiles.json"), JSON.stringify({ profiles: { core: ["test-missing"], empty: [] } }));
		fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "1.0.0" }));
		fs.writeFileSync(path.join(root, ".claude-plugin", "plugin.json"), JSON.stringify({ version: "0.9.0" }));
		fs.writeFileSync(path.join(root, ".claude-plugin", "marketplace.json"), JSON.stringify({ plugins: [{ source: "./x" }] }));

		expect(rules(validateDistribution(root, skills), "error").sort()).toEqual([
			"marketplace.source",
			"plugin.version",
			"profile.member",
			"profile.shape",
		]);
	});
});
