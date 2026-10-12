#!/usr/bin/env sh
# Remove test-skills with the open skills CLI (https://skills.sh), for any supported agent.
# Removes only this suite's skills by name. Arguments after "--" go to "npx skills remove"
# unchanged.
#
#   ./uninstall.sh                         # every test-* skill, user scope, all agents
#   ./uninstall.sh --profile ui            # one profile from profiles.json (repeatable)
#   ./uninstall.sh --project               # from the current project instead of user scope
#   ./uninstall.sh -- -a <agent>           # limit removal to specific agents
#   ./uninstall.sh --dry-run               # print what would happen without changing anything
#
set -eu

ROOT="$(cd "$(dirname "$0")" && pwd)"
. "$ROOT/scripts/common.sh"

SCOPE="-g"
SKILLS=""
DRY_RUN=0

while [ $# -gt 0 ]; do
	case "$1" in
		--profile)
			[ $# -ge 2 ] || die "--profile needs a name"
			SKILLS="$SKILLS $(profile_skills "$2")" || exit 1
			shift 2
			;;
		--project) SCOPE="" && shift ;;
		--dry-run) DRY_RUN=1 && shift ;;
		--) shift && break ;;
		-h | --help) sed -n '2,11p' "$0" && exit 0 ;;
		*) die "Unknown option $1 (pass skills CLI flags after --)" ;;
	esac
done

require_node
[ -n "$SKILLS" ] || SKILLS="$(all_skills)"

set -- remove $(printf '%s\n' $SKILLS | sort -u) $SCOPE -y "$@"

say "npx $SKILLS_CLI $*"
[ "$DRY_RUN" = 1 ] && exit 0
npx -y "$SKILLS_CLI" "$@"
