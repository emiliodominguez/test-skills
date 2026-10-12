import fs from "node:fs";
import path from "node:path";
import { load as loadYaml } from "js-yaml";
import type { Issue, Skill } from "./skill.js";

/**
 * Read and parse a JSON file relative to the repository root.
 *
 * @param root - Repository root.
 * @param file - Relative path.
 * @returns The parsed value, or undefined when the file is absent.
 */
function readJson(root: string, file: string): unknown {
	const full = path.join(root, file);

	return fs.existsSync(full) ? JSON.parse(fs.readFileSync(full, "utf8")) : undefined;
}

/**
 * Check the install surface: profiles name real skills, and the optional plugin manifests
 * stay in sync with `package.json`.
 *
 * @param root - Repository root.
 * @param skills - The loaded skills.
 * @returns Distribution issues.
 */
export function validateDistribution(root: string, skills: Skill[]): Issue[] {
	const issues: Issue[] = [];
	const names = new Set(
		skills.map(function toName(skill) {
			return skill.name;
		}),
	);
	const profiles = (readJson(root, "profiles.json") as { profiles?: Record<string, unknown> } | undefined)?.profiles ?? {};

	for (const [profile, members] of Object.entries(profiles)) {
		if (!Array.isArray(members) || members.length === 0) {
			issues.push({ skill: "profiles", level: "error", rule: "profile.shape", message: `profile "${profile}" must be a non-empty array` });
			continue;
		}

		for (const member of members) {
			if (!names.has(String(member))) {
				issues.push({
					skill: "profiles",
					level: "error",
					rule: "profile.member",
					message: `profile "${profile}" lists unknown skill ${member}`,
				});
			}
		}
	}

	const pkg = readJson(root, "package.json") as { version?: string } | undefined;
	const plugin = readJson(root, ".claude-plugin/plugin.json") as { version?: string } | undefined;

	if (plugin && plugin.version !== pkg?.version) {
		issues.push({
			skill: "manifest",
			level: "error",
			rule: "plugin.version",
			message: `plugin.json version ${plugin.version} != package.json ${pkg?.version}`,
		});
	}

	const marketplace = readJson(root, ".claude-plugin/marketplace.json") as { plugins?: Array<{ source?: string }> } | undefined;

	for (const entry of marketplace?.plugins ?? []) {
		if (entry.source !== "./") {
			issues.push({
				skill: "manifest",
				level: "error",
				rule: "marketplace.source",
				message: `marketplace entry source must be "./", got ${entry.source}`,
			});
		}
	}

	issues.push(...validateCodexManifests(root, skills, pkg?.version));

	return issues;
}

/** Fields Codex reads from a skill's `agents/openai.yaml` interface block, with their length limits. */
export const OPENAI_INTERFACE_FIELDS: Record<string, number> = {
	display_name: 64,
	short_description: 1024,
	default_prompt: 1024,
	icon_small: 1024,
	icon_large: 1024,
	brand_color: 16,
};

/**
 * Check the Codex adapter files: the plugin manifest and marketplace, and each skill's optional
 * `agents/openai.yaml`.
 *
 * @param root - Repository root.
 * @param skills - The loaded skills.
 * @param version - The package version the plugin manifest must match.
 * @returns Codex issues.
 */
export function validateCodexManifests(root: string, skills: Skill[], version: string | undefined): Issue[] {
	const issues: Issue[] = [];

	/**
	 * Record an error.
	 *
	 * @param skill - Skill or manifest the issue belongs to.
	 * @param rule - Stable rule id.
	 * @param message - Explanation.
	 */
	function error(skill: string, rule: string, message: string): void {
		issues.push({ skill, level: "error", rule, message });
	}

	const plugin = readJson(root, ".codex-plugin/plugin.json") as { name?: string; version?: string; skills?: string; hooks?: string } | undefined;

	if (plugin) {
		if (plugin.version !== version)
			error("codex", "codex.plugin.version", `.codex-plugin/plugin.json version ${plugin.version} != package.json ${version}`);

		for (const [field, value] of [
			["skills", plugin.skills],
			["hooks", plugin.hooks],
		] as const) {
			if (value !== undefined && (!value.startsWith("./") || !fs.existsSync(path.join(root, value)))) {
				error("codex", "codex.plugin.path", `.codex-plugin/plugin.json ${field} must be an existing "./" path, got ${value}`);
			}
		}

		const marketplace = readJson(root, ".agents/plugins/marketplace.json") as
			{ plugins?: Array<{ name?: string; source?: { source?: string; path?: string } }> } | undefined;
		const entry = marketplace?.plugins?.find(function sameName(candidate) {
			return candidate.name === plugin.name;
		});

		if (!entry || entry.source?.source !== "local" || entry.source.path !== "./") {
			error("codex", "codex.marketplace", `.agents/plugins/marketplace.json must list ${plugin.name} with a local "./" source`);
		}
	}

	for (const skill of skills) {
		const file = path.join(skill.dir, "agents", "openai.yaml");

		if (!fs.existsSync(file)) continue;

		let parsed: unknown;

		try {
			parsed = loadYaml(fs.readFileSync(file, "utf8"));
		} catch (err) {
			error(skill.name, "codex.interface.yaml", `agents/openai.yaml: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
			continue;
		}

		const interfaceBlock = (parsed as { interface?: Record<string, unknown> } | null)?.interface;

		if (!interfaceBlock || typeof interfaceBlock !== "object") {
			error(skill.name, "codex.interface.shape", "agents/openai.yaml needs an `interface` mapping");
			continue;
		}

		for (const [key, value] of Object.entries(interfaceBlock)) {
			const limit = OPENAI_INTERFACE_FIELDS[key];

			if (limit === undefined) error(skill.name, "codex.interface.field", `agents/openai.yaml: unknown interface field \`${key}\``);
			else if (typeof value !== "string" || value.trim() === "" || value.length > limit) {
				error(
					skill.name,
					"codex.interface.value",
					`agents/openai.yaml: \`${key}\` must be a non-empty string of at most ${limit} characters`,
				);
			}
		}

		if (typeof interfaceBlock.default_prompt === "string" && !interfaceBlock.default_prompt.includes(`$${skill.name}`)) {
			error(skill.name, "codex.interface.prompt", `agents/openai.yaml: default_prompt should invoke $${skill.name}`);
		}
	}

	return issues;
}
