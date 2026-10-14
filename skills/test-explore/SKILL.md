---
name: test-explore
description: "Autonomous UI exploration: generated action sequences checked against properties in every state, with Bombadil, fast-check or Hypothesis. Use for unscripted paths, monkey testing or lifting E2E assertions. Hands off to `test-findings`."
compatibility: "Verified with Bombadil 0.7.8 (web, Electron, terminal) and fast-check 4.10 with playwright-core 1.64 (web), on Linux with Chromium; Hypothesis stateful testing for Python teams."
metadata:
  stage: explore
---

# Exploration

A program drives the interface at random and, after every action, checks properties: rules that
must hold whatever the user did. It reports the shortest action sequence that breaks one, and
the report replays. Scripted end-to-end tests prove the paths someone wrote down; exploration
checks the rules on the paths nobody did.

## Choose a driver

| Driver | Fits | What you get |
| --- | --- | --- |
| Bombadil | Web, Electron, terminal programs; any stack | Temporal properties (`always`, `eventually.within`, `next`), recorded traces, the bundled runner and page kit |
| fast-check + Playwright | JavaScript or TypeScript projects already on Playwright | Model-based sequences inside the existing runner, shrinking to minimal reproductions, seed-and-path replay |
| Hypothesis + Playwright | Python projects | `RuleBasedStateMachine` rules and invariants, shrinking, a failure database |

Use what the repository already has. Adding a driver is a dependency decision: ask first. Read the
driver's reference before writing code: [bombadil.md](references/bombadil.md) and
[bombadil-spec.md](references/bombadil-spec.md), [fast-check.md](references/fast-check.md), or
[hypothesis.md](references/hypothesis.md). Mobile crawlers (Firebase Robo test, adb shell monkey,
Fastbot) find crashes and ANRs but check no custom properties: run one for crash discovery,
explore the state layer with model-based tests (`test-properties`), and keep device tours
scripted. Exploration needs a running UI; for model-based tests of code without a UI use
`test-properties`.

## Process

1. **Harness first.** A test build with stable hooks (test ids or roles with names), a fresh
   seeded data store per run, fake external services, and native dialogs, printing, external
   links and app quit fenced. Exploration against shared data or live integrations finds the
   harness, not bugs.
2. **Run the generic properties clean before writing any.** Uncaught errors, unhandled
   rejections, console errors, failed requests, broken values on screen (`NaN`, `undefined`,
   `[object Object]`, `Invalid Date`), typed markup that executes, Escape that cannot close a
   dialog, busy indicators that never clear. A violation on a healthy app means the app logs
   errors on purpose or the harness is wrong: fix that first. Each driver ships a different set:

   | Driver | Generic properties included |
   | --- | --- |
   | Bombadil | Defaults `noUncaughtExceptions`, `noUnhandledPromiseRejections`, `noConsoleErrors`, `noHttpErrorCodes`; the page kit adds `noBrokenValues`, `injectedTextStaysInert`, `escapeClosesDialogs`, `focusStaysInModal`, `busyIndicatorsSettle` and layout checks |
   | fast-check kit | `noUncaughtErrors`, `noConsoleErrors`, `noFailedRequests`, `noBrokenValues`, `injectedTextStaysInert`, `escapeClosesDialogs`, `busyIndicatorsSettle` |
   | Hypothesis | None bundled; the demo harness writes uncaught errors, broken values, inert injected text, Escape and busy indicators as invariants |
3. **Add domain properties.** Each is a rule with an extractor that reads only what it needs and
   returns "not judgeable" while the screen loads. Pick the shape:

   | Shape | Example |
   | --- | --- |
   | Invariant | The total equals the sum of the displayed lines |
   | Settles | May break while a list refetches, must hold again within N seconds |
   | Bounded guarantee | Every spinner clears within 10 seconds |
   | After an action | After Escape or Cancel, the dialog is gone |
   | Model agreement | Visible navigation equals what the role's permissions grant |
   | Monotonic | A counter never decreases without a reset action |

   Use the app's own pure code as the oracle where possible, and an independent table where a
   shared bug would hide. Name each property as the rule (`cartTotalAddsUp`).
4. **Design the actions.** Offer only actions valid now and resolve targets when the action runs,
   so sequences replay and shrink. Typed text comes from generators that include hostile values
   (empty, edge numbers, unicode, markup that reports execution), never from runtime randomness.
   Drive flows random clicks rarely finish (sign in, multi-step forms) as small workflow state
   machines; gate everything behind sign-in and keep random typing out of credential fields.
   Weight action kinds rather than filtering by history, and always include a wait.
5. **Prove each property silent, reached and able to fail.** Run it on a correct build with
   keep-going for 3-5 minutes: no violation, and the run reached the screen it judges. Show reach
   from the run, not from silence: the fast-check kit's report counts judged and skipped steps per
   property (return `null` when not judgeable), a Bombadil spec declares a reach list checked in
   the coverage report ([bombadil-campaigns.md](references/bombadil-campaigns.md)), and Hypothesis
   records it with `event()`. Then break the app on purpose (revert a
   historical fix, flip a comparison) and confirm the property catches it. A property that never
   saw its screen checked nothing, and one that restates a generic property only reports the same
   bug twice.
6. **Set the cadence.** A short smoke (2-5 minutes, stop on first violation) per change if the
   budget allows; long scheduled campaigns across seeds, locales, viewports, roles and fault
   profiles. Record every run's seed and setup next to its output.
7. **Hand findings over.** Replay each finding on a fresh app before trusting it, then triage with
   `test-findings` and pin the fixed bug with a scripted or unit test.

When the project already has scripted end-to-end tests, lift their assertions into properties:
read [from-e2e.md](references/from-e2e.md).

## Measured on the bundled demo

Three drivers explore `examples/buggy-shop` (six seeded bugs) with no scripted paths, and each
stays silent on the fixed build: Bombadil (`pnpm demo`) finds five or six per two-minute run;
fast-check (`pnpm demo:fc`) found all six in six of eight four-minute runs and five in the
others, each shrunk to one to five actions, including a stuck spinner reached by three adds,
Checkout and Place order; Hypothesis found all six in sixty examples. The harness details that
decided those numbers: sequences long enough for five-step bugs, a shrinking budget separate from
the search budget, and modals and busy indicators detected the way the app renders them. On a
second app, a stuck spinner behind the third "Load more" was reached only with a workflow command
for paging.

## Anti-patterns

- Trusting a finding that has not replayed on a fresh app.
- Properties added straight to a long campaign without a silent, reached covering run.
- Properties that flag the app echoing what the explorer typed.
- `eventually` without a bound, or a property that fails while a list refetches.
- Action targets chosen when the sequence is generated, so sequences neither replay nor shrink.
- Long unattended runs without a time limit, or treating a harness error exit as a pass.
- Deleting the scripted tests once exploration runs: the layers complement each other.

## Done when

- The generic properties run clean on the app, with the command and seed recorded.
- Each domain property was silent and reached on a correct build and caught a deliberate break.
- A known finding replays from its recorded seed or trace.
- The cadence (per change, scheduled) is wired or explicitly deferred.

Triage what runs find with `test-findings`.
