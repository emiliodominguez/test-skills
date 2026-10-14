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
| `genericProperties()` | `noUncaughtErrors`, `noBrokenValues`, `injectedTextStaysInert`, `escapeClosesDialogs`, `busyIndicatorsSettle` |
| `defaultCommands()` | Click, type (hostile text), press a key, wait; targets resolved when the command runs |
| `HOSTILE_TEXT`, `KEYS` | The value sets the default commands draw from |

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

Each property gets `{ action, before, after, errors, settled, typed }`: the action description,
snapshots before and after (visible text, open modal, busy indicator, injection sentinel, and
whatever `extract` returned under `app`), uncaught page errors raised during the action, whether
busy indicators cleared within the settle budget, and every text typed so far. Return `true`
when the rule holds, or a message when it does not. Transition rules (after Escape, the modal is
closed) compare `before` and `after`; temporal bounds come from the settle budget.

## Commands

- **Resolve targets at run time.** A command carries an index; when it runs, it marks the
  candidates on screen and takes `index % count`. A sequence then means something on any state,
  replays exactly, and shrinks to steps a person can read.
- **Scope to the open modal.** Elements behind a modal are inert; the kit only offers the modal's
  own controls while one is open.
- **Declare applicability in the model.** After every action the kit counts what is clickable and
  typeable, and a command's `check(model)` refuses to run without a target. fast-check then never
  generates "type into nothing" and drops such steps when shrinking; without it, a five-step bug
  came back as a fourteen-step reproduction full of no-ops.
- **Treat an action that fails mid-way as a no-op**, not a finding: the target vanished, or a
  number input refused text.
- **Workflows** that random clicks rarely finish (sign in, a wizard, a payment form) become their
  own command class: `check(model)` says when it applies, `run(model, real)` performs the steps
  with generated values. Mix them in with the default commands.
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

## Races and timing

`fc.scheduler()` reorders promises a component awaits (fetches, timers) under fast-check control
and shrinks the interleaving that breaks it. Use it at the component or store level with mocked
I/O, where the exploration above would only hit a race by luck.

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
