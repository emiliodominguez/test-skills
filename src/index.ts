import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateDistribution } from "./core/distribution.js";
import { discoverSkills, skillStage, validateCorpus, validateSkill, type Issue } from "./core/skill.js";

/** Repository root, resolved from this file so the CLI works from any working directory. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Location of the skill corpus. */
const SKILLS_DIR = path.join(ROOT, "skills");

/**
 * Print every skill with its stage and description length.
 */
function listCommand(): void {
	for (const skill of discoverSkills(SKILLS_DIR)) {
		const stage = skillStage(skill) ?? "?";

		console.log(`${skill.name.padEnd(28)} ${stage.padEnd(8)} ${String(skill.frontmatter.description).length} chars`);
	}
}

/**
 * Validate the corpus and distribution manifests. Sets a non-zero exit code on errors,
 * or on warnings with `--strict`.
 *
 * @param strict - Treat warnings as failures.
 */
function validateCommand(strict: boolean): void {
	const skills = discoverSkills(SKILLS_DIR);
	const issues: Issue[] = [
		...skills.flatMap(function check(skill) {
			return validateSkill(skill);
		}),
		...validateCorpus(skills),
		...validateDistribution(ROOT, skills),
	];
	const errors = issues.filter(function isError(issue) {
		return issue.level === "error";
	});
	const warnings = issues.length - errors.length;
	const descriptionChars = skills.reduce(function sum(acc, skill) {
		return acc + String(skill.frontmatter.description).length;
	}, 0);

	for (const issue of issues) console.log(`  ${issue.level.padEnd(5)}  ${issue.skill.padEnd(24)}  ${issue.rule}: ${issue.message}`);

	console.log(`Checked ${skills.length} skills, ${descriptionChars} description chars: ${errors.length} errors, ${warnings} warnings`);

	if (errors.length > 0 || (strict && warnings > 0)) process.exitCode = 1;
}

/**
 * Entry point: `list` or `validate [--strict]`.
 *
 * @param argv - Arguments after the script path.
 */
function main(argv: string[]): void {
	const [command, ...rest] = argv;

	if (command === "list") return listCommand();
	if (command === "validate") return validateCommand(rest.includes("--strict"));

	console.error("Usage: skills <list | validate [--strict]>");
	process.exitCode = 1;
}

main(process.argv.slice(2));
