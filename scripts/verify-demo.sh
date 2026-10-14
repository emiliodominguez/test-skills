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
# The fast-check demo prints its report as JSON so the check can require the seeded bugs by name,
# not only an exit code: a harness that finds nothing real must not pass as "found bugs".
REPORT="$(mktemp)"
pnpm -s demo:fc --json >"$REPORT"
code=$?
echo "demo:fc exit: $code (expected 2)"
[ "$code" = "2" ] || status=1
node -e '
	const report = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
	const found = new Set(report.findings.map(function name(finding) { return finding.property; }));
	const seeded = ["noUncaughtErrors", "noBrokenValues", "injectedTextStaysInert", "cartTotalAddsUp", "escapeClosesDialogs", "busyIndicatorsSettle"];
	const hits = seeded.filter(function hit(name) { return found.has(name); });
	const unreproduced = report.findings.filter(function lost(finding) { return !finding.reproduced; }).length;
	console.log("demo:fc found " + hits.length + " of " + seeded.length + " seeded bugs: " + hits.join(", ") + "; " + unreproduced + " did not reproduce");
	process.exit(found.has("harness") || hits.length < 4 || unreproduced > 0 ? 1 : 0);
' "$REPORT" || status=1
rm -f "$REPORT"
check demo:fc:fixed 0

exit $status
