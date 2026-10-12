#!/usr/bin/env sh
# End-to-end install check with the real skills CLI: discover the corpus from this checkout,
# install it into a throwaway project for several agents, then remove it with uninstall.sh.
# Needs network access to the npm registry for "npx skills".
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/common.sh"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/test-skills-smoke.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/home" "$WORK/project"
cd "$WORK/project"

# Keep CLI writes inside the fixture, including agent-specific overrides.
run_isolated() {
	env HOME="$WORK/home" CODEX_HOME="$WORK/home/.codex" CLAUDE_CONFIG_DIR="$WORK/home/.claude" \
		XDG_CONFIG_HOME="$WORK/home/.config" DISABLE_TELEMETRY=1 DO_NOT_TRACK=1 NO_COLOR=1 "$@"
}

EXPECTED="$(cd "$ROOT/skills" && for d in */; do [ -f "$d/SKILL.md" ] && printf '%s\n' "${d%/}"; done | sort)"

# Profiles resolve and the wrapper prints the command it would run.
run_isolated sh "$ROOT/install.sh" --local --project --profile hardening --dry-run | grep -q -- "--skill test-findings test-policy test-security"

run_isolated npx -y "$SKILLS_CLI" add "$ROOT" --list >"$WORK/list.txt" 2>&1
for name in $EXPECTED; do
	grep -q "$name" "$WORK/list.txt" || { cat "$WORK/list.txt"; echo "skills CLI did not discover $name" >&2; exit 1; }
done

run_isolated sh "$ROOT/install.sh" --local --project -- -a claude-code codex cursor --skill '*' -y --copy >"$WORK/install.log" 2>&1 || { cat "$WORK/install.log"; exit 1; }
if grep -Eq 'Failed to install' "$WORK/install.log"; then
	cat "$WORK/install.log"
	echo "skills CLI reported an install failure" >&2
	exit 1
fi

for dir in .claude/skills .agents/skills; do
	for name in $EXPECTED; do
		diff -qr "$ROOT/skills/$name" "$dir/$name" || { cat "$WORK/install.log"; echo "$dir/$name differs from source or is missing" >&2; exit 1; }
	done
done

run_isolated sh "$ROOT/uninstall.sh" --project -- -a claude-code codex cursor >"$WORK/uninstall.log" 2>&1 || { cat "$WORK/uninstall.log"; exit 1; }
for dir in .claude/skills .agents/skills; do
	for name in $EXPECTED; do
		[ ! -e "$dir/$name" ] || { cat "$WORK/uninstall.log"; echo "$dir/$name survived uninstall" >&2; exit 1; }
	done
done

echo "skills CLI installed and removed all $(printf '%s\n' "$EXPECTED" | wc -l | tr -d ' ') skills in project scope."
