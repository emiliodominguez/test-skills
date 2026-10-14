# fast-check + Playwright

Model-based exploration for JavaScript and TypeScript projects: `fc.commands` generates action
sequences, `fc.asyncModelRun` applies them to a live page, properties are checked after every
action, and fast-check shrinks a failing sequence to the shortest one that still fails. Verified
with fast-check 4.10.2 and playwright-core 1.64 on Chromium.

## Start from the kit

Copy `assets/fast-check-explore.mjs` from this skill's folder into the repository (for example
`tests/explore/fast-check-explore.mjs`). It needs `fast-check` and `playwright` (or
`playwright-core` with a browser path) as dev dependencies and gives you:

| Export | What it is |
| --- | --- |
| `explore(options)` | Searches until the time limit, then shrinks each violation on its own budget and replays it |
| `replay(options, finding)` | Reruns exactly one finding; refuses when the command set changed since it was recorded |
| `genericProperties(options)` | `noUncaughtErrors`, `noConsoleErrors`, `noFailedRequests`, `noBrokenValues`, `injectedTextStaysInert`, `escapeClosesDialogs`, `busyIndicatorsSettle`; `ignoreConsole` and `ignoreRequests` regexes for known-harmless noise |
| `defaultCommands(options)` | Click, type (hostile text), choose a select option, press a key, wait; targets resolved when the command runs |
| `Click`, `Type`, `SelectOption`, `Press`, `Wait`, `runStep` | The command classes, and the step runner a custom workflow command calls so its steps are judged |
| `fingerprint(options)` | Identifies a command set; findings carry it |
| `HOSTILE_TEXT`, `KEYS`, `CLICKABLE`, `TYPEABLE`, `MODAL`, `BUSY` | The value sets and selectors the commands use |

`explore` options:

| Option | Default | What it does |
| --- | --- | --- |
| `browser`, `url`, `properties` | required | A launched Playwright browser, the page each run opens, the properties |
| `extract(page)` | none | Reads app state into plain JSON, available to properties as `step.after.app` |
| `commands` | `defaultCommands()` | Command arbitraries; add workflow commands here |
| `contextOptions` | none | Options for each fresh context: `viewport`, `locale`, `timezoneId`, `storageState` |
| `setupPage(page)` | none | Runs before the page loads: `page.route` fakes, init scripts |
| `extendModel(page)` | none | Extra model fields read after every step, for workflow commands' `check(model)` |
| `timeLimitMs` | 120000 | Search budget; shrinking and replay time is added on top |
| `shrinkMs` | 120000 | Shrinking budget per finding |
| `settleMs`, `actionTimeoutMs` | 3000, 1000 | Busy-indicator wait per step; timeout of one click, fill or select |
| `numRuns`, `maxCommands`, `sequenceSize` | 200, 40, `"medium"` | Sequences per round, longest sequence, typical length |
| `seed`, `keepGoing`, `onFinding` | random, false, none | Starting seed; continue past the first finding; called as each finding is ready |

The report is `{ findings, runs, ms, seed, reach, fingerprint }`: `runs` counts search sequences,
`seed` is the starting seed (record it for clean runs too), and `reach` counts per property how
many steps it judged and how many it skipped. Each finding carries `property`, `message`, the
shrunk `actions`, `seed`, `path`, `replayPath`, `reproduced`, `shrinkInterrupted` (the shrinking
budget ran out, so the sequence may not be minimal) and `fingerprint`.

A finding whose `property` is `"harness"` means the harness failed (the page did not load, a
command crashed, the browser closed), not the app: exit 1, like a broken run, never as a found
bug. A property whose `check` throws is reported as a violation of that property with "check
threw", so a bug in a property does not end the exploration. Invalid time limits throw instead of
running nothing, and so does a run in which no sequence ran.

A complete harness, from the test-skills repository's `examples/buggy-shop/fast-check/explore.mjs`:

```js
import { chromium } from "playwright";
import { explore, genericProperties } from "./fast-check-explore.mjs";

const cartTotalAddsUp = {
	name: "cartTotalAddsUp",
	check: function cartTotalAddsUp(step) {
		const { lines, total } = step.after.app;

		if (total === null || lines.includes(null)) return null; // not judgeable yet: counted as skipped

		const sum = lines.reduce(function add(acc, line) {
			return acc + line;
		}, 0);

		return total === sum || `total ${total} != sum of lines ${sum}`;
	},
};

const browser = await chromium.launch();
const report = await explore({
	browser,
	url: "http://127.0.0.1:4173/",
	extract: readCart, // reads the page and returns plain JSON the properties need
	properties: [...genericProperties(), cartTotalAddsUp],
	timeLimitMs: 240_000,
	keepGoing: true,
	onFinding: printFinding,
});

await browser.close();
console.log(`seed ${report.seed}; reach ${JSON.stringify(report.reach)}`);

const harnessFailed = report.findings.some(function broken(finding) {
	return finding.property === "harness";
});

process.exitCode = harnessFailed ? 1 : report.findings.length > 0 ? 2 : 0;
```

## How a property sees a step

Each property gets the step: the action description, snapshots before and after (visible text,
open modal, busy indicator, injection sentinel, and whatever `extract` returned under `app`),
uncaught page errors, console errors and failed requests since the previous check, whether busy
indicators cleared within the settle budget, and every text typed so far. The first step of
every run is `"load page"`, so errors raised while the page loads are judged too. Return `true`
when the rule holds, `false` or a message when it does not, and `null` when the state cannot be
judged (loading, element absent). Transition rules (after Escape, the modal is closed) compare
`before` and `after`; temporal bounds come from the settle budget.

- **Reach:** a property with `judged: 0` in the report checked nothing. Prove step 5 of the skill
  from `report.reach`, not from the absence of findings.
- **Modal:** an open `dialog:modal`, or a visible `[role=dialog]` or `[role=alertdialog]` with
  `aria-modal="true"` (the exported `MODAL`). Visibility everywhere in the kit means
  `checkVisibility()`, so elements hidden by `display`, `visibility`, `opacity` or a closed
  ancestor do not count, and fixed-position elements do.
- **Busy:** `aria-busy="true"` or a `role="progressbar"` without `aria-valuenow` (the exported
  `BUSY`); a custom spinner needs one of them to be seen. The "after" snapshot is taken once the
  step settled, so `after.busy` is false on every settled step: use `settled`, not `after.busy`,
  to judge busy indicators.
- **`noConsoleErrors`** fails on a `console.error`; the browser's own "Failed to load resource"
  lines are left to **`noFailedRequests`**, which fails on network failures and 5xx responses
  (aborted requests from navigations are ignored). An app that logs errors on purpose, or a
  third-party script the harness did not fake, trips both on a healthy build: fake it in
  `setupPage`, or pass `ignoreConsole` or `ignoreRequests` with the reason recorded.
- **Overlap:** a domain property that restates a generic one (a second Escape check) reports the
  same bug twice under `keepGoing`. Do not duplicate the generic properties; triage deduplicates
  what remains.

## Commands

- **Resolve targets at run time.** A command carries an index; when it runs, it marks the
  candidates on screen and takes `index % count`. A sequence then means something on any state,
  replays exactly, and shrinks to steps a person can read. Off-origin and download links are not
  candidates.
- **Scope to the open modal.** Elements behind a modal are inert; the kit only offers the topmost
  modal's own controls while one is open.
- **Declare applicability in the model.** After every action the kit counts what is clickable,
  typeable and selectable, and a command's `check(model)` refuses to run without a target.
  fast-check then skips "type into nothing" when it would run (`check(model)` is evaluated at that
  point) and drops such steps when shrinking; without it, a five-step bug came back as a
  fourteen-step reproduction full of no-ops.
- **Treat an action that fails mid-way as a no-op**, not a finding: the target vanished, or a
  number input refused text.
- **Workflows** that random clicks rarely finish (sign in, a wizard, paging with "Load more")
  become their own command class: `check(model)` says when it applies, using fields that
  `extendModel` adds, and `run(model, real)` performs each step through
  `runStep(model, real, description, perform)`, so every step is judged and the model stays
  current. Pass them in `commands`:

  ```js
  import fc from "fast-check";
  import { defaultCommands, explore, runStep } from "./fast-check-explore.mjs";

  class SignIn {
  	check(model) {
  		return model.signInVisible;
  	}
  	async run(model, real) {
  		await runStep(model, real, "sign in as the demo user", async function perform(page) {
  			await page.getByLabel("Email").fill("demo@example.com");
  			await page.getByLabel("Password").fill("demo-password");
  			await page.getByRole("button", { name: "Sign in" }).click();
  		});
  	}
  	toString() {
  		return "sign in as the demo user";
  	}
  }

  await explore({
  	browser,
  	url,
  	properties,
  	commands: [...defaultCommands(), fc.constant(new SignIn())],
  	extendModel: async function signInState(page) {
  		return { signInVisible: await page.getByRole("button", { name: "Sign in" }).isVisible() };
  	},
  });
  ```

  A bug behind several clicks on one specific control (paging to the last page, a multi-step
  wizard) is rarely reached by the default mix; in a field trial, a spinner stuck on the third
  "Load more" was found only once a `LoadMore` workflow command existed.
- **Sequence length matters.** Bugs that need five steps are rarely reached with fast-check's
  default small sizes; the kit uses `size: "medium"` and up to 40 commands. On the demo shop,
  that took the five-step stuck-spinner bug from missed in most runs to found in every run.
- **Weight what matters.** Escape gets extra weight among keys: at uniform weights it was about
  2% of actions and the dialog bug was missed in two of three runs.

## Replay and shrinking

The search stops at the first failure without shrinking (`endOnFailure`). Shrinking then restarts
from that exact case (`seed` plus `path`) with its own budget (`shrinkMs`): a failure found in the
last seconds still gets a minimal reproduction. If the case does not fail again on its first
rerun, nothing else runs, so shrinking never wanders to a different failure. The shrunk case is
replayed once, in a fresh context, judged only by its own property. Time spent shrinking and
replaying is added back to the search deadline, so wall time is at most `timeLimitMs` plus, per
finding, `shrinkMs` and one replay; set the CI job timeout above that.

Shrinking finds a local minimum. Targets are indices into what is on screen, so a step that
changes how many candidates exist (a delete, a "Load more") cannot be dropped without retargeting
every later click: some reproductions keep a step or two more than the minimum, and
`shrinkInterrupted` says when the budget ran out first.

Keep `seed`, `path`, `replayPath` and `fingerprint`. A recorded seed and path only mean something
for the same command set: adding a command, changing weights or upgrading the kit (which may
change `defaultCommands()`) makes them replay a different sequence. `replay` compares
fingerprints and refuses on a mismatch instead of reporting "no longer fails", and reports
`sameActions` when it can compare with the finding's recorded actions. Each run uses a fresh
browser context, so browser state never leaks between sequences; server-side state does, so reset
the backend in `setupPage` or give each run its own data.

## Races and timing

Exploration hits a race only by luck. Races inside a store or component with mocked I/O are
`test-properties` work: `fc.scheduler()` and `fc.scheduledModelRun` control the order in which
awaited promises resolve and shrink the interleaving that breaks it.

## Gotchas

- An app echoing what the explorer typed (a preview, a search term) is not a broken value: the
  kit's `noBrokenValues` ignores a match only when it lies inside an occurrence of text the run
  actually typed, so a real `NaN` elsewhere on the screen is still caught.
- `fill` on `input[type=number]` rejects non-numeric text; that is an inapplicable action.
- Settling waits two animation frames and then only while a busy indicator is visible, so a
  healthy app costs little; a stuck one costs the settle budget per action.
- Native dialogs (`alert`, `confirm`) are dismissed so a run cannot block; markup that executes
  is detected through a sentinel the hostile payloads set.
- In the test-skills repository, `examples/explore-kit/verify.mjs` checks the kit's targeting,
  modal, busy, load-error, shrinking, replay and reach behaviors in Chromium.
