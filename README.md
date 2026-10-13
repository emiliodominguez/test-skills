<p align="center">
  <img src="docs/assets/test-skills-banner.webp" alt="A robotic test investigator discovers a bug hiding beneath a green checkmark in a testing laboratory." width="100%" />
</p>

# test-skills

### Tests that can fail.

Agent Skills for coding agents that **prove tests catch bugs**, **flag weakened assertions**, and
**explore the paths nobody scripts** with [Bombadil](https://github.com/antithesishq/bombadil).

[![Agent Skills: spec compliant](https://img.shields.io/badge/Agent%20Skills-spec%20compliant-8250df?style=for-the-badge&labelColor=161b22&logo=bookstack&logoColor=white)](https://agentskills.io/specification)
[![Agents: any](https://img.shields.io/badge/agents-any-0969da?style=for-the-badge&labelColor=161b22&logo=probot&logoColor=white)](https://github.com/vercel-labs/skills)
[![Install: npx skills add](https://img.shields.io/badge/npx-skills%20add-cb3837?style=for-the-badge&labelColor=161b22&logo=npm&logoColor=white)](https://skills.sh)
[![License: MIT](https://img.shields.io/badge/license-MIT-3da639?style=for-the-badge&labelColor=161b22&logo=opensourceinitiative&logoColor=white)](LICENSE)

**[Quick start](#quick-start)** · **[Choose a skill](#start-with-your-risk)** · **[Watch it find bugs](#see-it-find-bugs)** · **[All 13 skills](#all-skills)** · **[Measured results](#what-we-measured)**

> A green suite is a result. Show that it goes red when the code breaks.

## Quick start

```sh
npx skills add emiliodominguez/test-skills
```

Pick your skills and agent during installation. Requires **Node.js 22.20+**.
Using Codex or Claude Code? See the [agent-specific install options](#install).

Start with the audit and guard if you already have a suite:

```sh
npx skills add emiliodominguez/test-skills --skill test-audit test-guard
```

Then ask your agent:

```text
Audit this branch's tests. Find assertions that cannot fail, mutation-check the
behavior they claim to cover, and flag any tests weakened relative to main.
```

## Start with your risk

| You want to...                  | Start here                                     | What you get                                                                   |
| ------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------ |
| Trust an existing green suite   | [test-audit](skills/test-audit/SKILL.md)       | Suspicious tests identified and behavior checked with mutants                  |
| Stop tests getting bent to pass | [test-guard](skills/test-guard/SKILL.md)       | A diff report of deletions, skips, changed expectations and lowered thresholds |
| Find bugs beyond scripted flows | [test-bombadil](skills/test-bombadil/SKILL.md) | Property-driven exploration with replayable traces                             |
| Diagnose intermittent failures  | [test-flaky](skills/test-flaky/SKILL.md)       | A measured failure rate, an identified cause and a verified fix                |
| Plan a suite from scratch       | [test-strategy](skills/test-strategy/SKILL.md) | Risks mapped to test layers, oracles and cadence                               |

**13 skills. Four stages. An evidence trail.** Plan the risks, author the tests, explore the
unexpected, and triage failures into reproducible regressions. The bundled scripts also run
without an agent in CI or a pre-commit hook.

## The problem

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

## What you get

| Failure mode                                                                             | Skill                                                                                                        | Bundled tool                         |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| Tests that cannot fail: no assertions, tautologies, mocks of the unit, `.only`, sleeps   | [`test-audit`](skills/test-audit/SKILL.md)                                                                   | `audit-tests.mjs` + a mutation check |
| Tests weakened to get green: deleted, skipped, loosened, re-recorded, thresholds lowered | [`test-guard`](skills/test-guard/SKILL.md)                                                                   | `guard-tests.mjs`                    |
| "Just add a retry"                                                                       | [`test-flaky`](skills/test-flaky/SKILL.md)                                                                   | `repeat.mjs`                         |
| Bugs on paths nobody scripted                                                            | [`test-bombadil`](skills/test-bombadil/SKILL.md), [`test-bombadil-spec`](skills/test-bombadil-spec/SKILL.md) | runner, page kit, typed property kit |
| Assertions stuck on one path                                                             | [`test-e2e-to-bombadil`](skills/test-e2e-to-bombadil/SKILL.md)                                               |                                      |
| Examples that miss edge cases                                                            | [`test-properties`](skills/test-properties/SKILL.md)                                                         |                                      |
| Findings nobody can reproduce                                                            | [`test-findings`](skills/test-findings/SKILL.md)                                                             | replay, confirm, shrink              |

The scripts have zero dependencies and run without an agent too, in CI or a pre-commit hook.

## See it find bugs

[`examples/buggy-shop`](examples/buggy-shop) is a four-product store with six seeded bugs. Its
specification is the bundled property kit plus two domain properties. There are no scripted
paths and no selectors for the bugs.

```sh
git clone https://github.com/emiliodominguez/test-skills && cd test-skills
pnpm install && pnpm demo
```

One two-minute run (long typed strings shortened):

| Property               | Verdict | Count | First step | After                                     |
| ---------------------- | ------- | ----: | ---------: | ----------------------------------------- |
| injectedTextStaysInert | stop    |   294 |         11 | type "\"><svg id=bmbxss onload=alert(1)>" |
| noBrokenValues         | stop    |    97 |         74 | type "--3"                                |
| emptyCartIsFree        | stop    |    58 |         37 | Click "button                             |     | Remove Stoneware mug | 0"  |
| noDuplicateIds         | stop    |    40 |        101 | type "<a id=bmbxss href=javascript:..."   |
| noUncaughtExceptions   | stop    |    28 |         38 | Click "button                             |     | Apply                | 0"  |
| cartTotalAddsUp        | stop    |    16 |         25 | type "=]7oi&~u@Mr*$..."                   |
| escapeClosesDialogs    | stop    |     8 |        287 | key 27                                    |

Exploration is random: a single two-minute run usually finds five or six of the six seeded bugs,
and the stuck checkout spinner shows up within a few runs. Then `pnpm demo:fixed` serves the same
app with the bugs off and the same spec stays silent (about 850 states, exit 0). `pnpm verify` runs both,
with the rest of the gate, before every release.

Terminal programs too: [`examples/buggy-cli`](examples/buggy-cli) is a todo list TUI with three
seeded bugs (a byte cut that prints U+FFFD, a double-counted status line, a crash on position 0).
`pnpm demo:cli` finds all three in 45 seconds with no browser; `pnpm demo:cli:fixed` stays silent.

**It found a bug we did not plant.** The first "fixed" build still failed `cartTotalAddsUp`:
Bombadil typed a huge quantity, the line amount overflowed JavaScript's safe integers, and the
total stopped matching its lines. No one had written that test. The property did not need anyone to.

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

```json
{
	"hooks": {
		"Stop": [{ "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/skills/test-guard/scripts/guard-hook.mjs\"" }] }]
	}
}
```

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

## All skills

| Stage   | Skill                                                          | What moves forward                                                            |
| ------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Plan    | [`test-strategy`](skills/test-strategy/SKILL.md)               | A risk table: layer, oracle and cadence per risk, plus a maintenance contract |
| Author  | [`test-unit`](skills/test-unit/SKILL.md)                       | High-signal tests on the pure core; no mocks of the unit                      |
| Author  | [`test-properties`](skills/test-properties/SKILL.md)           | Property-based and model-based tests with shrinking                           |
| Author  | [`test-e2e`](skills/test-e2e/SKILL.md)                         | Scripted tours: isolated, fenced, semantic locators, no blind retries         |
| Author  | [`test-policy`](skills/test-policy/SKILL.md)                   | Repository-reading tests for conventions                                      |
| Author  | [`test-security`](skills/test-security/SKILL.md)               | Authorization matrix and schema-driven hostile input over every procedure     |
| Author  | [`test-bombadil-spec`](skills/test-bombadil-spec/SKILL.md)     | Bombadil properties and replayable action generators                          |
| Author  | [`test-e2e-to-bombadil`](skills/test-e2e-to-bombadil/SKILL.md) | Scripted assertions lifted into properties that hold on every path            |
| Explore | [`test-bombadil`](skills/test-bombadil/SKILL.md)               | Bombadil installed, harnessed and run on a cadence, with replayable traces    |
| Triage  | [`test-audit`](skills/test-audit/SKILL.md)                     | Tests that cannot fail, found; the rest proven by mutants                     |
| Triage  | [`test-guard`](skills/test-guard/SKILL.md)                     | A change checked for deleted, skipped and bent tests                          |
| Triage  | [`test-flaky`](skills/test-flaky/SKILL.md)                     | A measured failure rate, a named source and a proven fix                      |
| Triage  | [`test-findings`](skills/test-findings/SKILL.md)               | Findings reproduced, shrunk, classified and pinned by regression tests        |

Prompts to try:

```text
test-audit The agent added 30 tests in this branch. Find the ones that cannot fail,
then mutate the pricing code and tell me which mutants survive.

test-bombadil Set up Bombadil for this app with the bundled runner and page kit.
Run the defaults for two minutes and fix anything that fails on a healthy build.

test-e2e-to-bombadil Read our Playwright suite and lift every assertion that is really a rule
into a Bombadil property. Keep path facts in the scripts.
```

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

| Profile     | Skills                                                       |
| ----------- | ------------------------------------------------------------ |
| `honesty`   | audit, guard, flaky                                          |
| `bombadil`  | strategy, bombadil, bombadil-spec, e2e-to-bombadil, findings |
| `core`      | strategy, unit, e2e, audit, guard, flaky, findings           |
| `hardening` | policy, security, properties, findings                       |

```sh
./install.sh --profile honesty -- -a <agent> -y
./uninstall.sh --dry-run
```

For global installs, pass an explicit `-a` list. The `.claude-plugin/` folder is an optional
marketplace channel; `npx skills` is the recommended path. Requires Node.js 22.20+.

## How it is verified

- `pnpm check`: formatting, types (the property kit is type-checked against Bombadil 0.7.8),
  skill validation and tests for every bundled script.
- `scripts/verify-demo.sh`: the demo must find the seeded bugs and stay silent when fixed.
- `pnpm verify` runs all of it locally; the GitHub workflow is manual-only.
- `scripts/smoke-install.sh`: a real `npx skills` install and removal for several agents.
- `scripts/codex-check.mjs`: 19 checks against the real Codex CLI, from skill loading to the
  plugin, the hook and the sandboxes.
- The test audit reports no findings on a 199-file production suite it was not written for.
- `pnpm dogfood`: the bundled scripts are mutation-tested with their own `mutate.mjs`. Scores:
  audit 82.5%, guard 92.4%, repeat 94.1% (up from 55%, 58% and untested). The survivors it
  surfaced led to three real fixes: regex literals hid findings from the audit, a test file
  renamed out of the runner's reach passed the guard, and a killed mutation run left a mutant in
  the source.

Skills name testing tools where the tool is the point and stay neutral elsewhere. They name no
agent host or model. Bombadil guidance targets 0.7.x; see the
[gotchas](skills/test-bombadil/references/gotchas.md) found while verifying it.

## Credits

[Bombadil](https://github.com/antithesishq/bombadil) is built by Antithesis. For property-based
testing across more languages and tools, see also
[trailofbits/skills](https://github.com/trailofbits/skills).

## Contributing

```sh
pnpm install --frozen-lockfile
pnpm check
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [authoring](docs/AUTHORING.md). MIT [license](LICENSE).
