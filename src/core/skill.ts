import fs from "node:fs";
import path from "node:path";
import { load as loadYaml } from "js-yaml";

/** Parsed YAML frontmatter of a SKILL.md. `name` and `description` are required. */
export interface SkillFrontmatter {
	name: string;
	description: string;
	[key: string]: unknown;
}

/** A single skill loaded from disk. */
export interface Skill {
	/** Directory name: the canonical id, must equal `frontmatter.name`. */
	name: string;
	/** Absolute path to the skill directory. */
	dir: string;
	/** Parsed frontmatter. */
	frontmatter: SkillFrontmatter;
	/** Markdown body with the frontmatter stripped. */
	body: string;
	/** YAML parse failure captured so validation can report it without aborting the corpus scan. */
	parseError?: string;
	/** Concatenated Markdown of supporting files under `references/`, scanned for skill references. */
	supporting: string;
	/** Relative links found in supporting files, keyed by the file they appear in. */
	supportingLinks: Array<{ file: string; link: string }>;
}

/** A validation finding. `error` fails the gate; `warn` is advisory unless `--strict`. */
export interface Issue {
	skill: string;
	level: "error" | "warn";
	rule: string;
	message: string;
}

/** Every skill in this repository shares this prefix; backticked tokens with it must resolve. */
export const SKILL_PREFIX = "test-";

/** Hard limit from the Agent Skills spec; hosts truncate or reject beyond it. */
export const DESCRIPTION_MAX_LENGTH = 1024;

/** Descriptions stay in every session's context, so each one should stay near this size. */
export const DESCRIPTION_TARGET_LENGTH = 280;

/** Below this, a description gives the model too little to match the skill on. */
export const DESCRIPTION_MIN_LENGTH = 80;

/** Combined description budget for the whole corpus; hosts cap the always-loaded skill index. */
export const DESCRIPTION_CORPUS_BUDGET = 4000;

/** The spec recommends keeping SKILL.md under 500 lines and roughly 5,000 tokens. */
export const BODY_MAX_LINES = 500;

/** A conservative 4-characters-per-token estimate of the 5,000-token body guidance. */
export const BODY_MAX_CHARS = 20000;

/** The only frontmatter fields allowed: the Agent Skills specification, so every host reads skills the same way. */
export const SPEC_FIELDS = ["name", "description", "license", "compatibility", "metadata", "allowed-tools"];

/** Verbs that introduce a description's handoff clause. */
export const HANDOFF_VERB = /\b(hands? (?:off|back) to|routes? to|feeds?)\b/i;

/** Low-value filler that weakens instructions. */
export const WEASEL_WORDS = ["simply", "basically", "effortlessly", "trivially", "needless to say", "as you can see", "it goes without saying"];

/** Canonical kebab-case check for skill ids. */
export const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Testing stages, in workflow order. Each skill declares one as `metadata.stage`. */
export const STAGES = ["plan", "author", "explore", "run", "triage"] as const;

/** A testing stage from {@link STAGES}. */
export type Stage = (typeof STAGES)[number];

/**
 * The declared stage of a skill.
 *
 * @param skill - A loaded skill.
 * @returns The stage, or undefined when missing or unknown.
 */
export function skillStage(skill: Skill): Stage | undefined {
	const metadata = skill.frontmatter.metadata;
	const stage = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>).stage : undefined;

	return STAGES.find(function matches(known) {
		return known === stage;
	});
}

/**
 * Parse a SKILL.md's leading `---` frontmatter as YAML.
 *
 * @param raw - Full SKILL.md contents.
 * @returns The parsed key/value data, the body with frontmatter stripped, and a parse error if any.
 */
export function parseFrontmatter(raw: string): { data: Record<string, unknown>; body: string; error?: string } {
	const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/.exec(raw);

	if (!match) return { data: {}, body: raw.trim() };

	const body = (match[2] ?? "").trim();

	try {
		const parsed = loadYaml(match[1]!);

		if (parsed === null || parsed === undefined) return { data: {}, body };

		if (typeof parsed !== "object" || Array.isArray(parsed)) return { data: {}, body, error: "frontmatter must be a YAML mapping" };

		return { data: parsed as Record<string, unknown>, body };
	} catch (err) {
		return { data: {}, body, error: err instanceof Error ? err.message.split("\n")[0] : String(err) };
	}
}

/**
 * Relative Markdown link targets, ignoring URLs, anchors and absolute paths.
 *
 * @param markdown - Markdown text.
 * @returns Link paths without fragments.
 */
export function localLinks(markdown: string): string[] {
	return [...markdown.matchAll(/\]\(([^)\s]+)\)/g)]
		.map(function stripFragment(match) {
			return match[1]!.split("#")[0]!;
		})
		.filter(function isLocal(link) {
			return link !== "" && !/^[a-z][a-z0-9+.-]*:/i.test(link) && !link.startsWith("/");
		});
}

/**
 * Load and parse a single skill directory.
 *
 * @param dir - Absolute path to a directory containing a SKILL.md.
 * @returns The parsed skill.
 * @throws When the directory has no SKILL.md.
 */
export function loadSkill(dir: string): Skill {
	const file = path.join(dir, "SKILL.md");

	if (!fs.existsSync(file)) throw new Error(`No SKILL.md in ${dir}`);

	const { data, body, error } = parseFrontmatter(fs.readFileSync(file, "utf8"));
	const referencesDir = path.join(dir, "references");
	const referenceFiles = fs.existsSync(referencesDir)
		? fs
				.readdirSync(referencesDir)
				.filter(function isMarkdown(entry) {
					return entry.endsWith(".md");
				})
				.sort()
		: [];
	const supportingLinks: Skill["supportingLinks"] = [];
	const supporting = referenceFiles
		.map(function readReference(entry) {
			const text = fs.readFileSync(path.join(referencesDir, entry), "utf8");

			for (const link of localLinks(text)) supportingLinks.push({ file: `references/${entry}`, link });

			return text;
		})
		.join("\n");

	return {
		name: path.basename(dir),
		dir,
		frontmatter: { name: "", description: "", ...data } as SkillFrontmatter,
		body,
		parseError: error,
		supporting,
		supportingLinks,
	};
}

/**
 * Load every skill under a directory, sorted by name.
 *
 * @param skillsDir - Absolute path to the `skills/` directory.
 * @returns The loaded skills.
 */
export function discoverSkills(skillsDir: string): Skill[] {
	if (!fs.existsSync(skillsDir)) return [];

	return fs
		.readdirSync(skillsDir, { withFileTypes: true })
		.filter(function hasSkillFile(entry) {
			return entry.isDirectory() && fs.existsSync(path.join(skillsDir, entry.name, "SKILL.md"));
		})
		.map(function load(entry) {
			return loadSkill(path.join(skillsDir, entry.name));
		})
		.sort(function byName(a, b) {
			return a.name.localeCompare(b.name);
		});
}

/**
 * Structural validation of one skill: frontmatter shape, naming, description, body size and links.
 *
 * @param skill - A loaded skill.
 * @returns Issues found; empty when clean.
 */
export function validateSkill(skill: Skill): Issue[] {
	const issues: Issue[] = [];
	const fm = skill.frontmatter;
	const name = typeof fm.name === "string" ? fm.name : "";
	const description = typeof fm.description === "string" ? fm.description : "";

	/**
	 * Record an issue against this skill.
	 *
	 * @param level - Severity.
	 * @param rule - Stable rule id.
	 * @param message - Human-readable explanation.
	 */
	function add(level: Issue["level"], rule: string, message: string): void {
		issues.push({ skill: skill.name, level, rule, message });
	}

	if (skill.parseError) add("error", "frontmatter.yaml", `invalid YAML: ${skill.parseError}`);

	if (!name) {
		add("error", "frontmatter.name", "missing or non-string `name` in frontmatter");
	} else {
		if (name !== skill.name) add("error", "name.match-dir", `frontmatter name "${name}" != directory "${skill.name}"`);
		if (name.length > 64) add("error", "name.length", "skill names must not exceed 64 characters");
		if (!KEBAB.test(name)) add("error", "name.kebab", `name "${name}" is not kebab-case`);
		if (!name.startsWith(SKILL_PREFIX)) add("error", "name.prefix", `name "${name}" must start with "${SKILL_PREFIX}"`);
	}

	if (!description) {
		add("error", "frontmatter.description", "missing or non-string `description` in frontmatter");
	} else {
		if (description.includes("\n")) add("error", "description.single-line", "description must be a single line");

		if (description.length > DESCRIPTION_MAX_LENGTH) {
			add("error", "description.length", `description is ${description.length} chars (> ${DESCRIPTION_MAX_LENGTH})`);
		} else if (description.length > DESCRIPTION_TARGET_LENGTH) {
			add(
				"warn",
				"description.budget",
				`description is ${description.length} chars (> ${DESCRIPTION_TARGET_LENGTH}); it is loaded in every session`,
			);
		}

		if (description.length < DESCRIPTION_MIN_LENGTH)
			add("warn", "description.thin", `description is only ${description.length} chars (< ${DESCRIPTION_MIN_LENGTH})`);
		if (!HANDOFF_VERB.test(description))
			add("warn", "description.handoff", "description has no handoff clause (hands off to / routes to / feeds)");
	}

	for (const key of Object.keys(fm)) {
		if (!SPEC_FIELDS.includes(key))
			add("error", "frontmatter.portable", `\`${key}\` is not an Agent Skills spec field; skills must stay host-agnostic`);
	}

	const metadata = fm.metadata;

	if (metadata !== undefined && (typeof metadata !== "object" || metadata === null || Array.isArray(metadata))) {
		add("error", "metadata.shape", "`metadata` must be a map of string keys to string values");
	} else if (
		metadata &&
		Object.values(metadata).some(function isNotString(value) {
			return typeof value !== "string";
		})
	) {
		add("error", "metadata.shape", "`metadata` values must be strings");
	}

	if (!skillStage(skill)) add("error", "metadata.stage", `\`metadata.stage\` must be one of: ${STAGES.join(", ")}`);

	const lines = skill.body.split("\n").length;

	if (lines > BODY_MAX_LINES || skill.body.length > BODY_MAX_CHARS) {
		add("warn", "body.size", `body is ${lines} lines / ${skill.body.length} chars; move situational material to references/`);
	}

	for (const link of localLinks(skill.body)) {
		if (!fs.existsSync(path.join(skill.dir, link))) add("error", "link.missing", `links to ${link}, which does not exist`);
	}

	for (const { file, link } of skill.supportingLinks) {
		if (!fs.existsSync(path.join(skill.dir, path.dirname(file), link)))
			add("error", "link.missing", `${file} links to ${link}, which does not exist`);
	}

	const weasel = WEASEL_WORDS.filter(function appears(word) {
		return new RegExp(`\\b${word}\\b`, "i").test(skill.body);
	});

	if (weasel.length > 0) add("warn", "prose.weasel", `filler that weakens instructions: ${weasel.join(", ")}`);
	if (!/^##\s+Done when/im.test(skill.body)) add("warn", "structure.done-when", "no `## Done when` completion gate");
	if (!/^##.*anti-pattern/im.test(skill.body)) add("warn", "structure.guardrails", "no `## Anti-patterns` section");

	return issues;
}

/**
 * Extract backticked tokens that look like a skill name in this family.
 *
 * @param text - Prose that may mention skills.
 * @returns Referenced names in order, with duplicates.
 */
export function extractSkillRefs(text: string): string[] {
	const pattern = new RegExp("`(" + SKILL_PREFIX + "[a-z0-9-]+)`", "g");

	return [...text.matchAll(pattern)].map(function captured(match) {
		return match[1]!;
	});
}

/**
 * Cross-skill checks: empty corpus, combined description budget and dangling skill references.
 *
 * @param skills - The full set of loaded skills.
 * @returns Corpus-level issues.
 */
export function validateCorpus(skills: Skill[]): Issue[] {
	if (skills.length === 0) return [{ skill: "corpus", level: "error", rule: "corpus.empty", message: "no skills found" }];

	const issues: Issue[] = [];
	const names = new Set(
		skills.map(function toName(skill) {
			return skill.name;
		}),
	);
	const total = skills.reduce(function sum(acc, skill) {
		return acc + String(skill.frontmatter.description ?? "").length;
	}, 0);

	if (total > DESCRIPTION_CORPUS_BUDGET) {
		issues.push({
			skill: "corpus",
			level: "error",
			rule: "corpus.description-budget",
			message: `descriptions total ${total} chars (> ${DESCRIPTION_CORPUS_BUDGET})`,
		});
	}

	for (const skill of skills) {
		const dangling = new Set(
			extractSkillRefs(`${skill.body}\n${skill.frontmatter.description}\n${skill.supporting}`).filter(function unknown(ref) {
				return !names.has(ref);
			}),
		);

		for (const ref of dangling) {
			issues.push({ skill: skill.name, level: "error", rule: "reference.dangling", message: `references ${ref}, which is not a known skill` });
		}
	}

	return issues;
}
