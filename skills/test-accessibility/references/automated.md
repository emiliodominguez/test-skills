# Automated scans

Rule engines, how to run them in each runner, how to read their results and how to gate on new
violations only. Sections marked "measured" were checked by running axe-core 4.14 here, and
`examples/accessibility/verify.mjs` reproduces the target-size, jsdom contrast, hidden state and
baseline facts. The rest come from each tool's documentation: confirm them on upgrade.

## Engines

| Tool | What it is | Use it for |
| --- | --- | --- |
| axe-core | The rule engine most wrappers embed. Results: `violations`, `incomplete`, `passes`, `inapplicable` | Any browser driver, by injecting the script |
| @axe-core/playwright, @axe-core/webdriverjs, cypress-axe | Wrappers that inject axe-core and run it on the current page | Scans inside existing browser tests |
| jest-axe, vitest-axe | axe-core in jsdom with a matcher | Component tests (`test-component`) |
| pa11y, pa11y-ci | CLI scanner and crawler; runners `axe` and `htmlcs` (HTML_CodeSniffer), scripted `actions` | Scheduled crawls of every route |
| Lighthouse, Lighthouse CI | A weighted accessibility score over a subset of axe audits | Trend reporting; gate on individual audits, not the score |

Two engines disagree at the edges. Pick one engine for the gate so a failure has one meaning;
run a second on the schedule if you want a wider net.

## axe-core 4.14 facts (measured)

- WCAG tags: `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`. There is no `wcag22a` tag,
  and `wcag22aa` holds one rule, `target-size`.
- A default `axe.run()` skips `target-size`, the AAA rules (`color-contrast-enhanced`,
  `identical-links-same-purpose`, `meta-refresh-no-exceptions`), experimental and deprecated
  rules, and runs most `best-practice` rules. Pass `runOnly` tags so the gate means "WCAG A and
  AA".
- With the tag, two 16 px buttons in a flex row two pixels apart are `target-size` violations.
  WCAG exempts targets inside a sentence, so small inline buttons may come back `inapplicable`.
- Under jsdom, `color-contrast` lands in `incomplete`, never in `violations`: there is no layout
  or canvas. Contrast needs a real browser.
- Hidden content is not scanned: a closed dialog, a collapsed menu or an error that is not shown
  yet produces no violations until it is rendered.

## Raw axe-core in any browser driver (measured)

No wrapper needed: inject the installed script and run it. This is what
`examples/accessibility/verify.mjs` does with playwright-core.

```js
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const AXE_PATH = require.resolve("axe-core");
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * Run axe in the page and flatten violations to one entry per node. Runs in the page.
 *
 * @param {string[]} tags - Rule tags to run.
 * @returns {Promise<Array<{ rule: string, target: string, help: string }>>} Violations.
 */
async function runAxeInPage(tags) {
	const results = await window.axe.run(document, { runOnly: { type: "tag", values: tags } });
	const flat = [];

	for (const violation of results.violations) {
		for (const node of violation.nodes) flat.push({ rule: violation.id, target: node.target.join(" "), help: violation.helpUrl });
	}

	return flat;
}

/**
 * Scan the page as it is now. Inject axe once per document.
 *
 * @param {import("playwright-core").Page} page - The page.
 * @returns {Promise<Array<{ rule: string, target: string, help: string }>>} Violations.
 */
async function scan(page) {
	const loaded = await page.evaluate(function hasAxe() {
		return typeof window.axe !== "undefined";
	});

	if (!loaded) await page.addScriptTag({ path: AXE_PATH });

	return page.evaluate(runAxeInPage, WCAG_TAGS);
}
```

Drive into each state, then scan:

```js
await page.getByRole("button", { name: "Delete account" }).click();
await page.getByRole("dialog").waitFor();
expect(await scan(page)).toEqual([]);
```

A page with a strict Content Security Policy may refuse the injected script; scan a test build
with a relaxed policy or use the driver's CSP bypass option.

## @axe-core/playwright (from the package documentation)

```ts
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("address dialog has no WCAG A or AA violations", async function addressDialog({ page }) {
	await page.goto("/checkout");
	await page.getByRole("button", { name: "Change address" }).click();

	const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).include('[role="dialog"]').analyze();

	expect(results.violations.map(fingerprint)).toEqual([]);
});
```

`include` narrows a state scan to the region that changed; `exclude` removes a named third-party
region (keep a reason and an expiry next to it). Assert on the list of fingerprints so a failure
names every rule at once.

## Component tests

Run axe on the rendered container in each state with `color-contrast` disabled, and assert the
rule ids equal `[]`; `test-component` owns the setup. A component-level pass says nothing about
contrast, focus visibility, reflow or target size: those need the browser scans above.

## pa11y-ci (from the package documentation)

```json
{
	"defaults": { "standard": "WCAG2AA", "runners": ["axe"], "timeout": 30000 },
	"urls": [
		"http://127.0.0.1:4173/",
		{
			"url": "http://127.0.0.1:4173/checkout",
			"actions": ["click element #change-address", "wait for element [role=dialog] to be visible"]
		}
	]
}
```

`actions` reach states a crawler would miss. Check which axe tags the runner derives from
`standard`; it may not include the 2.1 and 2.2 rules, in which case pass the rules explicitly.

## Lighthouse CI (from the package documentation)

The accessibility score is a weighted average, so a new violation can hide behind a fixed one
and the score stays flat. Assert the audits you care about one by one (audit ids follow axe rule
ids, such as `button-name` and `color-contrast`) and keep the score as a trend line.

## Reading results

| Bucket | Meaning | Action |
| --- | --- | --- |
| `violations` | A rule failed on a node | Gate on it |
| `incomplete` | axe could not decide: text over images or gradients, pseudo-elements, jsdom | Review queue; the manual pass or a browser scan decides |
| `passes` | Checked and fine | Ignore, or count to prove the scan reached the state |
| `inapplicable` | Nothing to check | Ignore; a rule you expect to apply being here means the state was not reached |

## Excluding and disabling

- Exclude a region, not a rule: a third-party widget the team cannot change gets an `exclude`
  selector, a reason, an owner and an expiry date in the same file.
- Disable a rule only for a known false positive in a stated axe version, with a link to the
  upstream issue, and re-check on upgrade.

## Baselines: fail only on new violations (measured)

Record existing debt, fail when a scan adds a violation, and report fixed ones so the baseline
shrinks.

```js
/**
 * Stable key for a violation.
 *
 * @param {{ rule: string, target: string }} violation - A flattened violation.
 * @returns {string} `rule target`.
 */
function fingerprint(violation) {
	return `${violation.rule} ${violation.target}`;
}

/**
 * Compare a scan with the recorded baseline for the same page and state.
 *
 * @param {string[]} baseline - Recorded fingerprints.
 * @param {Array<{ rule: string, target: string }>} current - Violations found now.
 * @returns {{ added: string[], resolved: string[] }} New violations and fixed ones.
 */
function diffAgainstBaseline(baseline, current) {
	const now = new Set(current.map(fingerprint));
	const known = new Set(baseline);

	return {
		added: [...now].filter(function isNew(key) {
			return !known.has(key);
		}),
		resolved: [...known].filter(function isGone(key) {
			return !now.has(key);
		}),
	};
}
```

Store the baseline as JSON keyed by page and state (`"/checkout dialog-open"`), with an owner per
entry. Policy:

- Fail on `added`. Fail on `resolved` too, with the message "remove these entries": the baseline
  only shrinks, and nobody can quietly re-introduce a fixed violation.
- axe builds target selectors from ids when unique, otherwise from structural paths that shift
  when markup changes. Give elements in debt a stable id, and when churn renames a target, review
  the paired added and resolved entries together.
- Never record a baseline on a branch with new UI: the debt it captures is the change under review.

## Per change versus scheduled

- Per change: the changed pages, each in its listed states, with the WCAG tags; under a minute.
- Scheduled: every route and locale, WCAG tags plus `best-practice` as a report, the baseline size
  as a trend, and the `incomplete` queue for review.
