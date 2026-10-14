#!/usr/bin/env sh
# Proves the exploration demos end to end (Bombadil web and terminal, fast-check web): each must
# find the seeded bugs (exit 2) and stay silent on the fixed build (exit 0). The web demos need
# Chrome or Chromium (set CHROME if it is not on PATH); the terminal demo needs only Node.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

status=0

# Runs one demo script and compares its exit code with the expected one.
check() {
	pnpm -s "$1"
	code=$?
	echo "$1 exit: $code (expected $2)"
	[ "$code" = "$2" ] || status=1
}

check demo 2
check demo:fixed 0
check demo:cli 2
check demo:cli:fixed 0
check demo:fc 2
check demo:fc:fixed 0

exit $status
