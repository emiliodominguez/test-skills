#!/usr/bin/env sh
# Proves both Bombadil demos end to end: each spec must find the seeded bugs (exit 2) and stay
# silent on the fixed build (exit 0). The web demo needs Chrome or Chromium (set CHROME if it is
# not on PATH); the terminal demo needs only Node.
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

exit $status
