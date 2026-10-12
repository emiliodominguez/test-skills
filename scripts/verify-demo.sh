#!/usr/bin/env sh
# Proves the Bombadil demo end to end: the spec must find the seeded bugs (exit 2) and stay silent
# on the fixed build (exit 0). Needs Chrome or Chromium (set CHROME if it is not on PATH).
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

pnpm -s demo
buggy=$?
pnpm -s demo:fixed
fixed=$?

echo "buggy build exit: $buggy (expected 2), fixed build exit: $fixed (expected 0)"
[ "$buggy" = 2 ] && [ "$fixed" = 0 ]
