import fs from "node:fs";
import path from "node:path";
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

	return issues;
}
