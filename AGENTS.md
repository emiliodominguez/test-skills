# AGENTS.md - test-skills

Project guidance for agent sessions working in this repository. Global user instructions still apply.

## What this is

The source of the host-agnostic `test-*` skill suite for testing applications. It is distributed
from GitHub through the open skills CLI (`npx skills add emiliodominguez/test-skills`).
`.claude-plugin/` and `.codex-plugin/` (with `.agents/plugins/marketplace.json`) are optional plugin
channels sharing `hooks/hooks.json`. Nothing is published to npm.

## Architecture

`skills/<name>/SKILL.md` is the source of truth, with optional `references/*.md` loaded on demand.
`profiles.json` holds install profiles. `install.sh` / `uninstall.sh` wrap `npx skills add/remove`.
`src/` is an authoring CLI only (`pnpm skills list|validate`): `src/core/skill.ts` parses and
validates skills, `src/core/distribution.ts` checks profiles and manifests.

## Required gate

Run `pnpm check` before committing (format check, typecheck, validate, tests). Run `pnpm smoke`
for install script or manifest changes; it needs npm registry access. `pnpm verify` adds the
Bombadil demos, the install smoke test and `pnpm codex` (the real Codex CLI, no model needed). CI is manual-only (no Actions minutes): never rely on it.
After changing a bundled script, run `pnpm dogfood` (mutation testing of the scripts with
`mutate.mjs`, slow) and kill the survivors that matter with tests, not by lowering the floor.

## Skill authoring

- Keep the anatomy: frontmatter, a short outcome, a process, `## Anti-patterns`, `## Done when`,
  and a final line naming the next skill. See [docs/AUTHORING.md](docs/AUTHORING.md).
- Frontmatter holds only Agent Skills spec fields (`name`, `description`, optional
  `compatibility`, `metadata.stage`). Stages: `plan`, `author`, `explore`, `triage`.
- Bodies name no agent host or model and use no invocation syntax. Testing tools may be named
  when the skill is about that tool. Refer to other skills by backticked name.
- Descriptions stay under 280 characters, lead with what the skill is, then `Use when`
  triggers, and end with a handoff clause (`Hands off to`, `Hands back to`, `Routes to`, `Feeds`).
- Every skill needs markers in `evals/beats.json` and four should prompts plus three near misses
  in `evals/triggers.json`.
- `agents/openai.yaml` in each skill is the one host-specific adapter file (Codex display name,
  short description and a `$skill` default prompt); `pnpm validate` checks it. Keep host syntax there,
  never in `SKILL.md`.
- No product or project names from the codebases these skills were distilled from. Examples use
  neutral domains (cart, checkout, invoices).

## Conventions

- Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `ci:`).
- No arrow functions in `src/`, tests or code examples inside skills: use function declarations, or named
  function expressions for callbacks. JSDoc on every function.
- Tabs (width 4), print width 150. No em or en dashes in prose; use an ASCII hyphen.
