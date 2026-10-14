# Hooks: make the guard automatic

`test-guard` ships `guard-hook.mjs`, a wrapper around `guard-tests.mjs` for hooks. When a change
weakens tests it prints the findings to stderr and exits 2; otherwise it exits 0. It reads an
optional JSON payload on stdin (`cwd`, `stop_hook_active`) and lets a second stop through, so an
agent that justified its change is not blocked forever. Outside a git repository it does nothing.

Paths below assume the skill was installed into the project with `npx skills add`; adjust them to
where your agent keeps skills (for example `.claude/skills/` or `.agents/skills/`, or the same
folders under your home directory for a user-scope install).

## Claude Code

Project settings, `.claude/settings.json`:

```json
{
	"hooks": {
		"Stop": [
			{
				"hooks": [
					{
						"type": "command",
						"command": "node \"$CLAUDE_PROJECT_DIR/.claude/skills/test-guard/scripts/guard-hook.mjs\""
					}
				]
			}
		]
	}
}
```

Exit 2 from a Stop hook keeps the agent working and shows it the hook's stderr; the hook input
carries `stop_hook_active`, which the script uses to avoid blocking twice. Installing this
repository as a plugin through `.claude-plugin/` registers the same hook from
[`hooks/hooks.json`](../hooks/hooks.json). Reference: <https://code.claude.com/docs/en/hooks>.

## Codex

Codex reads the same `hooks.json` shape. Put it in the project's `.codex/hooks.json` (or
`~/.codex/hooks.json` for every project):

```json
{
	"hooks": {
		"Stop": [
			{
				"hooks": [{ "type": "command", "command": "node .agents/skills/test-guard/scripts/guard-hook.mjs" }]
			}
		]
	}
}
```

What `scripts/codex-check.mjs` verifies against the real CLI (0.162.1):

- The Stop payload carries `cwd` and `stop_hook_active`, as the script expects.
- Exit 2 with a non-empty stderr blocks the stop and hands stderr to the agent as its next
  instruction; exit 2 with an empty stderr does not block, so the script always writes its findings.
- A project `.codex/hooks.json` is read only in a trusted project, and every non-managed hook is
  registered as untrusted until you approve it in Codex's `/hooks` view. Until then it does not run.
- Installing this repository as a Codex plugin registers the same Stop hook from
  [`hooks/hooks.json`](../hooks/hooks.json); Codex sets `PLUGIN_ROOT` and `CLAUDE_PLUGIN_ROOT` for
  plugin hooks, so one file serves both hosts. It also needs approval in `/hooks`.

## Other agents

Agents with an end-of-turn hook can run the same command. Check your agent's documentation for the
payload and for how it treats exit code 2; the script only needs a working directory inside the
repository.

## Git

`.githooks/pre-commit`, enabled with `git config core.hooksPath .githooks`:

```sh
#!/bin/sh
exec node .claude/skills/test-guard/scripts/guard-hook.mjs --base HEAD
```

`--base HEAD` checks every uncommitted change, staged or not, including untracked files. A pre-push hook can omit it to compare against
the merge base with the default branch.

## CI

Run the guard itself against the target branch, with enough history for the merge base:

```sh
git fetch origin main --depth=200
node .claude/skills/test-guard/scripts/guard-tests.mjs --base origin/main
```

Pair it with the audit on the changed test files:

```sh
git diff --name-only --diff-filter=d origin/main... -- '*.test.*' '*.spec.*' '*_test.*' '*test_*.py' |
	xargs -r node .claude/skills/test-audit/scripts/audit-tests.mjs
```
