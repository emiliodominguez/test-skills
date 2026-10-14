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
| `replay(options, finding)` | Reruns one finding from its `seed`, `path` and `replayPath` |
| `genericProperties(options)` | `noUncaughtErrors`, `noConsoleErrors`, `noFailedRequests`, `noBrokenValues`, `injectedTextStaysInert`, `escapeClosesDialogs`, `busyIndicatorsSettle`; `ignoreConsole` and `ignoreRequests` regexes for known-harmless noise |
| `defaultCommands()` | Click, type (hostile text), choose a select option, press a key, wait; targets resolved when the command runs |
| `Click`, `Type`, `SelectOption`, `Press`, `Wait`, `runStep` | The command classes, and the step runner a custom workflow command calls so its steps are judged |
| `HOSTILE_TEXT`, `KEYS`, `CLICKABLE`, `TYPEABLE`, `MODAL`, `BUSY` | The value sets and selectors the commands use |

A finding whose `property` is `"harness"` means the harness failed (the page did not load, a
command crashed), not the app: treat it like a broken run (exit 1), never as a found bug. A
property whose `check` throws is reported as a violation of that property with "check threw", so
a bug in a property does not end the exploration. Invalid time limits throw instead of running
nothing. `examples/explore-kit/verify.mjs` in this repository checks these behaviors in Chromium.

A complete harness is the kit plus an extractor and one or two domain properties; see
`examples/buggy-shop/fast-check/explore.mjs` in this repository.

```js
import { chromium } from "playwright";
import { explore, genericProperties } from "./fast-check-explore.mjs";

const cartTotalAddsUp = {
	name: "cartTotalAddsUp",
	check: function cartTotalAddsUp(step) {
		const { lines, total } = step.after.app;

		if (total === null || lines.includes(null)) return true; // not judgeable yet

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
process.exitCode = report.findings.length > 0 ? 2 : 0;
```

## How a property sees a step

Each property gets the step: the action description, snapshots before and after (visible text,
open modal, busy indicator, injection sentinel, and whatever `extract` returned under `app`),
uncaught page errors, console errors and failed requests recorded during the action, whether
busy indicators cleared within the settle budget, and every text typed so far. The kit's JSDoc
lists the exact field names. Return `true` when the rule holds, or a message when it does not.
Transition rules (after Escape, the modal is closed) compare `before` and `after`; temporal
bounds come from the settle budget.

- **Modal:** an open `dialog:modal`, or a visible `[role=dialog]` or `[role=alertdialog]` with
  `aria-modal="true"`. Visibility everywhere in the kit means `checkVisibility()`, so elements
  hidden by `display`, `visibility` or a closed ancestor do not count.
- **`noConsoleErrors`** fails on a `console.error` during the action and **`noFailedRequests`** on
  a request that failed during it. An app that logs errors on purpose, or a third-party script
  the harness did not fake, trips both on a healthy build: fix the harness or drop the property
  for that app with the reason recorded.

## Commands

- **Resolve targets at run time.** A command carries an index; when it runs, it marks the
  candidates on screen and takes `index % count`. A sequence then means something on any state,
  replays exactly, and shrinks to steps a person can read.
- **Scope to the open modal.** Elements behind a modal are inert; the kit only offers the modal's
  own controls while one is open.
- **Declare applicability in the model.** After every action the kit counts what is clickable and
  typeable, and a command's `check(model)` refuses to run without a target. fast-check then skips
  "type into nothing" at run time (`check(model)` is evaluated when the command would run) and
  drops such steps when shrinking; without it, a five-step bug came back as a fourteen-step
  reproduction full of no-ops.
- **Treat an action that fails mid-way as a no-op**, not a finding: the target vanished, or a
  number input refused text.
- **Workflows** that random clicks rarely finish (sign in, a wizard, a payment form) become their
  own command class: `check(model)` says when it applies, and `run(model, real)` performs each
  step through `runStep(model, real, description, perform)`, so every step is judged by the
  properties and the model stays current. Mix them in with the default commands:

  ```js
  class SignIn {
  	check(model) {
  		return model.typeable > 0;
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

  const commands = [...defaultCommands(), fc.constant(new SignIn())];
  ```
- **Sequence length matters.** Bugs that need five steps are rarely reached with fast-check's
  default small sizes; the kit uses `size: "medium"` and up to 40 commands. On the demo shop,
  that took the five-step stuck-spinner bug from missed in most runs to found in every run.
- **Weight what matters.** Escape gets extra weight among keys: at uniform weights it was about
  2% of actions and the dialog bug was missed in two of three runs.

## Replay and shrinking

The search stops at the first failure without shrinking (`endOnFailure`), so the time limit
bounds only the search. Shrinking then restarts from that exact case (`seed` plus `path`) with its
own budget (`shrinkMs`, two minutes by default): a failure found in the last seconds still gets a
minimal reproduction instead of whatever the time limit interrupted. The shrunk case is replayed
once in a fresh context to record readable actions and confirm it reproduces. Keep the
`seed`, `path` and `replayPath`: `fc.commands` needs the replay path, and exploration and replay
must build the sequence arbitrary with the same options. Each run uses a fresh browser context,
so state never leaks between sequences; shrinking reruns many sequences, so keep the time limit.

Wall time is at most `timeLimitMs` plus, per finding, `shrinkMs` and one replay; set the CI job
timeout above that. The kit treats a time-limit interruption before any sequence completed as
the end of the budget, not a finding; such a run checked nothing, so raise the time limit rather
than read its silence as a pass.

## Races and timing

Exploration hits a race only by luck. Races inside a store or component with mocked I/O are
`test-properties` work: `fc.scheduler()` and `fc.scheduledModelRun` control the order in which
awaited promises resolve and shrink the interleaving that breaks it.

## Gotchas

- An app echoing what the explorer typed (a preview, a search term) is not a broken value; the
  kit's `noBrokenValues` ignores matches that occur in typed text.
- `fill` on `input[type=number]` rejects non-numeric text; that is an inapplicable action.
- Settling waits only while a busy indicator is visible, so a healthy app costs nothing extra; a
  stuck one costs the settle budget per action.
- `fc.check` with `interruptAfterTimeLimit` returns `interrupted` rather than failing; the kit
  ends the search there.
- Native dialogs (`alert`, `confirm`) are dismissed so a run cannot block; markup that executes
  is detected through a sentinel the hostile payloads set.
