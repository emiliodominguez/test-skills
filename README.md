<p>
  <img src="docs/assets/test-skills-fracture.webp" alt="test-skills. Break the code. Keep the test. An olive ceramic checkmark splits into displaced sections, exposing its fault lines." width="100%" />
</p>

# test-skills

**Tests that can fail.** Seventeen Agent Skills for every kind of testing a coding agent writes:
unit, component, integration, end-to-end, property-based, exploration, accessibility, visual,
performance, security and LLM evals. Each technique skill ships evidence that its test catches a seeded bug,
plus the tools that prove a green suite can fail.

[![Agent Skills: spec compliant](https://img.shields.io/badge/Agent%20Skills-spec%20compliant-8250df?style=for-the-badge&labelColor=161b22&logo=bookstack&logoColor=white)](https://agentskills.io/specification)
[![Agents: any](https://img.shields.io/badge/agents-any-0969da?style=for-the-badge&labelColor=161b22&logo=probot&logoColor=white)](https://github.com/vercel-labs/skills)
[![Install: npx skills add](https://img.shields.io/badge/npx-skills%20add-cb3837?style=for-the-badge&labelColor=161b22&logo=npm&logoColor=white)](https://skills.sh)
[![License: MIT](https://img.shields.io/badge/license-MIT-3da639?style=for-the-badge&labelColor=161b22&logo=opensourceinitiative&logoColor=white)](LICENSE)

[Install](#quick-start) · [Break a test](#would-your-tests-notice) · [Choose a skill](#choose-your-first-move) · [Every kind of test](#every-kind-of-test-with-evidence) · [Run the demo](#see-it-find-bugs) · [Evidence](#what-we-measured)

## Quick start

```sh
npx skills add emiliodominguez/test-skills
```

Pick your skills and agent. **Node.js 22.20+** required.
[Codex, Claude Code, plugins and profiles →](#install)

Already have a suite? Start with `test-audit` and `test-guard`:

```sh
npx skills add emiliodominguez/test-skills --skill test-audit test-guard
```

## Would your tests notice?

Suppose `total([12, 8])` must return `20`. This assertion passes:

```js
assert.equal(total([12, 8]), total([12, 8]));
```

Now replace the implementation with `return 0`. **Still green.** The test compares the function
with itself; it never checks the requirement.

<details>
<summary><strong>Give the test something to lose.</strong></summary>

Use an independent expected result:

```js
assert.equal(total([12, 8]), 20);
```

The broken implementation now fails: `0 !== 20`. Fix the implementation and keep the assertion.

That is the loop behind `test-audit`: identify suspicious tests, introduce controlled faults,
and check which ones the suite detects. A surviving mutant calls for investigation; it can
expose missing coverage or be equivalent to the original behavior.

**A killed mutant is evidence about that fault, not a guarantee that the program is correct.**

</details>

## Choose your first move

| The question                              | Start here                                       | Bring back                                                      |
| ----------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------- |
| **Does green mean anything?**             | [`test-audit`](skills/test-audit/SKILL.md)       | Audit findings and mutation evidence                            |
| **Did the tests get easier?**             | [`test-guard`](skills/test-guard/SKILL.md)       | A diff of skips, deletions, changed expectations and thresholds |
| **What happens off the happy path?**      | [`test-explore`](skills/test-explore/SKILL.md)   | Property failures shrunk to replayable reproductions            |
| **Why does this fail sometimes?**         | [`test-flaky`](skills/test-flaky/SKILL.md)       | A measured failure rate, a cause and a verified fix             |
| **What deserves a test, and which kind?** | [`test-strategy`](skills/test-strategy/SKILL.md) | Risks mapped to test types, layers, oracles and cadence         |

The audit, guard and repeat scripts have zero dependencies. Run them directly in CI or a
pre-commit hook, with or without an agent. [Browse all 17 skills →](#all-skills)

## Every kind of test, with evidence

Each skill that teaches a technique carries a module with a seeded bug, the test the skill
recommends catching it, and the same test passing on the fix. They run in `pnpm check` or
`pnpm verify`.

| The trap                               | Skill                                                      | What the evidence shows                                                                                            |
| -------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Examples that miss edge cases          | [`test-properties`](skills/test-properties/SKILL.md)       | Five property shapes, each catching a bug its example test misses, shrunk to cases like `allocate(1, 2)`           |
| Only the scripted paths are tested     | [`test-explore`](skills/test-explore/SKILL.md)             | Bombadil, fast-check and Hypothesis find the same seeded bugs in one shop                                          |
| Component tests coupled to markup      | [`test-component`](skills/test-component/SKILL.md)         | Role queries catch a mouse-only button; test ids pass it, and axe reports nothing                                  |
| Mocks standing in for the database     | [`test-integration`](skills/test-integration/SKILL.md)     | A mocked client passes three bugs that real SQLite catches                                                         |
| Accessibility "covered" by a scan      | [`test-accessibility`](skills/test-accessibility/SKILL.md) | axe reports zero violations on a page with nine keyboard, semantics and layout bugs; browser checks catch all nine |
| Screenshot tests that flake or miss    | [`test-visual`](skills/test-visual/SKILL.md)               | A 6px shift fails at a measured threshold and passes at 5%; an unmasked clock fails 5 of 5 runs                    |
| Performance tests that flake           | [`test-performance`](skills/test-performance/SKILL.md)     | Count budgets and a scaling ratio: 0 failures in 90 repeated runs, 70 under parallel load                          |
| An eval average that hides regressions | [`test-llm`](skills/test-llm/SKILL.md)                     | 80% before and after a prompt change with two cases broken; the per-case gate fails it                             |

---

## See it find bugs

[`examples/buggy-shop`](examples/buggy-shop) is a four-product store with six seeded bugs. Three
exploration drivers run against it with no scripted paths and no selectors for the bugs.

| Driver                        | Budget      | Seeded bugs found                                                  | Fixed build |
| ----------------------------- | ----------- | ------------------------------------------------------------------ | ----------- |
| Bombadil 0.7.8                | 2 minutes   | 5 or 6 of 6 per run                                                | Silent      |
| fast-check 4.10 + Playwright  | 4 minutes   | 6 of 6 in 6 of 8 runs, 5 in the others; each shrunk to 1-5 actions | Silent      |
| Hypothesis 6.169 + Playwright | 60 examples | 6 of 6 in the latest run, 5 of 6 in two earlier ones               | Passes      |

> **The unexpected find:** the first "fixed" build still has an integer-overflow bug. Bombadil
> discovers it by entering a huge quantity and checking that the cart total matches its lines.

```sh
git clone https://github.com/emiliodominguez/test-skills && cd test-skills
pnpm install
pnpm demo       # Bombadil
pnpm demo:fc    # fast-check + Playwright
python -m pytest examples/buggy-shop/hypothesis -q   # Hypothesis (needs hypothesis, playwright, pytest)
```

fast-check shrinks each finding to the shortest sequence that still fails, and every one replays
from its seed:

```text
✗ escapeClosesDialogs: Escape left the modal open
  1. click button "Add Green tea to cart"
  2. click button "Checkout"
  3. press Escape
✗ busyIndicatorsSettle: a busy indicator did not clear within the settle budget
  1. click button "Add Green tea to cart"
  2. click button "Add Stoneware mug to cart"
  3. click button "Add Gooseneck kettle to cart"
  4. click button "Checkout"
  5. click button "Place order"
```

<details>
<summary><strong>Open the Bombadil field report: one two-minute run</strong></summary>

Long typed strings are shortened. Counts are reported property failures, not distinct bugs.

| Property                 | Verdict | Count | First step | After                                       |
| ------------------------ | ------- | ----: | ---------: | ------------------------------------------- |
| `injectedTextStaysInert` | stop    |   294 |         11 | `type "\"><svg id=bmbxss onload=alert(1)>"` |
| `noBrokenValues`         | stop    |    97 |         74 | `type "--3"`                                |
| `emptyCartIsFree`        | stop    |    58 |         37 | `Click "button\|\|Remove Stoneware mug\|0"` |
| `noDuplicateIds`         | stop    |    40 |        101 | `type "<a id=bmbxss href=javascript:..."`   |
| `noUncaughtExceptions`   | stop    |    28 |         38 | `Click "button\|\|Apply\|0"`                |
| `cartTotalAddsUp`        | stop    |    16 |         25 | `type "=]7oi&~u@Mr*$..."`                   |
| `escapeClosesDialogs`    | stop    |     8 |        287 | `key 27`                                    |

</details>

Exploration is random: a single run usually finds five or six of the six seeded bugs. Then
`pnpm demo:fixed` and `pnpm demo:fc:fixed` serve the same app with the bugs off and both stay
silent (`BUGGY_SHOP_FIXED=1` for the Hypothesis harness). `pnpm verify` runs the Bombadil and
fast-check demos, with the rest of the gate, before every release; the Hypothesis harness is run
by hand.

Terminal programs too: [`examples/buggy-cli`](examples/buggy-cli) is a todo list TUI with three
seeded bugs (a byte cut that prints U+FFFD, a double-counted status line, a crash on position 0).
`pnpm demo:cli` finds all three in 45 seconds with no browser; `pnpm demo:cli:fixed` stays silent.

---

## Catch a weakened test

```text
$ node skills/test-guard/scripts/guard-tests.mjs --base main
error  added-skip           src/cart.test.ts  0 -> 1 skip markers
warn   changed-expectation  src/cart.test.ts  expect(total([1, 2])): .toBe(3) -> .toBe(4)
error  deleted-test-file    src/legacy.test.ts  2 tests deleted
error  lowered-threshold    vitest.config.ts  lines: 80 -> 60
error  added-retries        vitest.config.ts  retries 0 -> 3

guard-tests vs main: WEAKENED (4 errors, 1 other)
```

Make it automatic: `guard-hook.mjs` blocks an agent's stop hook once when tests were weakened,
so the agent has to restore them or justify each one before it can finish. One entry in your
agent's hook settings, or a git pre-commit hook; see [docs/HOOKS.md](docs/HOOKS.md).

<details>
<summary>Wire the guard into a Claude Code Stop hook</summary>

```json
{
	"hooks": {
		"Stop": [{ "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/skills/test-guard/scripts/guard-hook.mjs\"" }] }]
	}
}
```

</details>

---

## What we measured

We gave fresh agents the same tasks with and without the skills, two replicates each, and scored
their suites with the bundled mutation tester ([full results](evals/results/2026-10-12-agent-tests.md)).

- On small, clearly specified modules the model already wrote strong tests: 98-100% mutation
  scores, hand-rolled fakes instead of mocks, and code fixes instead of bent tests, with or
  without the skills.
- On a larger billing module (77 mutants), both plain suites left real behavior unchecked
  (97.4% and 98.7%); both skill arms ran the mutants, closed their gaps and reached 100% with
  fewer tests. Two runs per arm: a direction, not a rate.
- With the skills, agents measured their own work: they ran the audit, the mutants and the guard,
  explained the one equivalent mutant, and flagged a test edit for review with its justification.
  That took about twice the wall time.
- So the claim is evidence first: every green suite comes with proof that it can fail, gaps get
  closed where there is headroom, and the scripts check any author's tests in CI or a hook.

<details>
<summary>Research and reports behind the problem</summary>

Your agent says the suite is green. That claim is cheap:

- **Agents over-mock.** In agent-authored commits, 36% of test commits add mocks, against 26%
  for humans, and agents reach for plain mocks 95% of the time
  ([MSR 2026](https://arxiv.org/abs/2602.00409v1)).
- **Coverage lies.** LLM-written tests on a large industrial codebase reached a 25.2% mutation
  score: most of the lines they "covered" could be broken without a single failure
  ([ESEM 2026](https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.ESEM.2026.95)).
- **Tests get bent to pass.** Developers report agents rewriting a failing test so that the wrong
  result counts as a pass ([HN](https://news.ycombinator.com/item?id=43307809)), and calling a
  failure "preexisting" to move on ([HN](https://news.ycombinator.com/item?id=47660925)).
- **Nobody scripts the weird paths.** End-to-end tests check the flows someone wrote down. The
  bugs live in the ones nobody did.

</details>

---

## All skills

| Stage   | Skill                                                      | What moves forward                                                                             |
| ------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Plan    | [`test-strategy`](skills/test-strategy/SKILL.md)           | A risk table: test type, layer, oracle and cadence per risk, plus a catalog of every test type |
| Author  | [`test-unit`](skills/test-unit/SKILL.md)                   | High-signal tests on the pure core; no mocks of the unit                                       |
| Author  | [`test-properties`](skills/test-properties/SKILL.md)       | Property-based, metamorphic and model-based tests with shrinking; fuzzing                      |
| Author  | [`test-component`](skills/test-component/SKILL.md)         | Component tests through roles, user events and a faked network                                 |
| Author  | [`test-integration`](skills/test-integration/SKILL.md)     | Real databases, migrations on data, contracts and fault injection                              |
| Author  | [`test-e2e`](skills/test-e2e/SKILL.md)                     | Scripted tours on web, desktop and mobile: isolated, fenced, no blind retries                  |
| Author  | [`test-accessibility`](skills/test-accessibility/SKILL.md) | axe in every state plus keyboard, focus and screen reader checks                               |
| Author  | [`test-visual`](skills/test-visual/SKILL.md)               | Deterministic screenshots, measured thresholds, reviewed baselines                             |
| Author  | [`test-performance`](skills/test-performance/SKILL.md)     | Counts, scaling ratios, benchmarks, load tests and web budgets that do not flake               |
| Author  | [`test-security`](skills/test-security/SKILL.md)           | Authorization matrix and schema-driven hostile input over every procedure                      |
| Author  | [`test-llm`](skills/test-llm/SKILL.md)                     | Mocked-model tests, output contracts and evals gated per case                                  |
| Author  | [`test-policy`](skills/test-policy/SKILL.md)               | Repository-reading tests for conventions                                                       |
| Explore | [`test-explore`](skills/test-explore/SKILL.md)             | Generated action sequences against properties, with Bombadil, fast-check or Hypothesis         |
| Triage  | [`test-audit`](skills/test-audit/SKILL.md)                 | Tests that cannot fail, found; the rest proven by mutants                                      |
| Triage  | [`test-guard`](skills/test-guard/SKILL.md)                 | A change checked for deleted, skipped and bent tests                                           |
| Triage  | [`test-flaky`](skills/test-flaky/SKILL.md)                 | A measured failure rate, a named source and a proven fix                                       |
| Triage  | [`test-findings`](skills/test-findings/SKILL.md)           | Findings reproduced, shrunk, classified and pinned by regression tests                         |

<details>
<summary>Prompts to try with your agent</summary>

```text
test-strategy Plan the tests for the new checkout: list the risks and pick the kind of test
and the layer for each.

test-audit The agent added 30 tests in this branch. Find the ones that cannot fail,
then mutate the pricing code and tell me which mutants survive.

test-explore Set up exploration for this app with the driver that fits our stack, run the
generic properties clean, then add a property that the cart total always adds up.

test-llm We are switching models for the ticket classifier. Build an eval set from our
logs and gate the switch on per-case flips, not the average.
```

</details>

---

## Install

```sh
npx skills add emiliodominguez/test-skills                                  # pick skills and agents
npx skills add emiliodominguez/test-skills -g -a <agent> -y                 # user scope, no prompts
npx skills add emiliodominguez/test-skills --skill test-audit test-guard    # just some skills
```

### Codex

Skills install into `.agents/skills/`, where Codex looks:

```sh
npx skills add emiliodominguez/test-skills -a codex -y
```

Or as a Codex plugin, which adds the skills under the `test-skills:` namespace and the guard's
Stop hook (approve it once in `/hooks`):

```sh
codex plugin marketplace add emiliodominguez/test-skills
codex plugin add test-skills@test-skills
```

`pnpm codex` checks all of this against the real Codex CLI without a model: skills load with
their descriptions and `agents/openai.yaml` metadata, the plugin and its hook register, the
guard hook blocks a weakened Stop, and the scripts behave inside Codex's read-only and
workspace-write sandboxes.

### Claude Code

`npx skills add emiliodominguez/test-skills -a claude-code -y`, or the `.claude-plugin/`
marketplace. See [docs/HOOKS.md](docs/HOOKS.md) for the Stop hook.

### Profiles

From a clone (membership in [`profiles.json`](profiles.json)):

| Profile      | Skills                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------- |
| `core`       | strategy, unit, component, integration, e2e, audit, guard, flaky, findings                    |
| `frontend`   | strategy, component, e2e, accessibility, visual, performance, explore, flaky, guard, findings |
| `backend`    | strategy, unit, integration, properties, performance, security, flaky, findings               |
| `generative` | properties, explore, findings                                                                 |
| `honesty`    | audit, guard, flaky                                                                           |
| `hardening`  | policy, security, properties, findings                                                        |
| `ai`         | strategy, llm, unit, flaky, findings                                                          |

```sh
./install.sh --profile frontend -- -a <agent> -y
./uninstall.sh --dry-run
```

For global installs, pass an explicit `-a` list. The `.claude-plugin/` folder is an optional
marketplace channel; `npx skills` is the recommended path. Requires Node.js 22.20+.

## How it is verified

- `pnpm check`: formatting, types (the Bombadil property kit is type-checked against 0.7.8),
  skill validation, tests for every bundled script, and the evidence suites
  (`test/*-examples.test.ts`: properties, component, integration, performance, LLM).
- `pnpm verify` adds the browser evidence (`scripts/verify-examples.mjs`: 27 accessibility
  claims, 7 visual), the exploration demos (Bombadil web and terminal, fast-check; each must
  find the seeded bugs and stay silent when fixed), a real `npx skills` install and removal for
  several agents, and 19 checks against the real Codex CLI. The GitHub workflow is manual-only.
- The test audit reports no findings on a 199-file production suite it was not written for.
- `pnpm dogfood`: the bundled scripts are mutation-tested with their own `mutate.mjs`. Scores:
  audit 82.5%, guard 92.4%, repeat 94.1% (up from 55%, 58% and untested). The survivors it
  surfaced led to three real fixes: regex literals hid findings from the audit, a test file
  renamed out of the runner's reach passed the guard, and a killed mutation run left a mutant in
  the source.
- The technique skills' "Measured in this repository" sections say what was run and what was not:
  Testcontainers, Pact, k6, Lighthouse CI and hosted visual tools are described from their
  documentation, not claimed as verified.

Skills name testing tools where the tool is the point and stay neutral elsewhere. They name no
agent host or model. Bombadil guidance targets 0.7.x; see the
[gotchas](skills/test-explore/references/bombadil-gotchas.md) found while verifying it.

## Credits

[Bombadil](https://github.com/antithesishq/bombadil) is built by Antithesis.
[fast-check](https://github.com/dubzzz/fast-check), [Hypothesis](https://hypothesis.works),
[axe-core](https://github.com/dequelabs/axe-core), [Playwright](https://playwright.dev),
[Testing Library](https://testing-library.com) and [MSW](https://mswjs.io) power the evidence.
For more property-based testing material, see also
[trailofbits/skills](https://github.com/trailofbits/skills).

## Contributing

```sh
pnpm install --frozen-lockfile
pnpm check
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [authoring](docs/AUTHORING.md). MIT [license](LICENSE).
