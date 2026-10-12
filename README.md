# test-skills

**Tests that can fail.** Agent Skills that stop coding agents from writing tests that test
nothing, catch them when they weaken tests to get green, and let
[Bombadil](https://github.com/antithesishq/bombadil) find the bugs nobody wrote a test for.

[![Agent Skills: spec compliant](https://img.shields.io/badge/Agent%20Skills-spec%20compliant-8250df?style=for-the-badge&labelColor=161b22&logo=bookstack&logoColor=white)](https://agentskills.io/specification)
[![Agents: any](https://img.shields.io/badge/agents-any-0969da?style=for-the-badge&labelColor=161b22&logo=probot&logoColor=white)](https://github.com/vercel-labs/skills)
[![Install: npx skills add](https://img.shields.io/badge/npx-skills%20add-cb3837?style=for-the-badge&labelColor=161b22&logo=npm&logoColor=white)](https://skills.sh)
[![License: MIT](https://img.shields.io/badge/license-MIT-3da639?style=for-the-badge&labelColor=161b22&logo=opensourceinitiative&logoColor=white)](LICENSE)

```sh
npx skills add emiliodominguez/test-skills
```

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

```text
| Property               | Verdict | Count | First step | After                                      |
| ---------------------- | ------- | ----: | ---------: | ------------------------------------------ |
| injectedTextStaysInert | stop    |   294 |         11 | type "\"><svg id=bmbxss onload=alert(1)>"  |
| noBrokenValues         | stop    |    97 |         74 | type "--3"                                 |
| emptyCartIsFree        | stop    |    58 |         37 | Click "button||Remove Stoneware mug|0"     |
| noDuplicateIds         | stop    |    40 |        101 | type "<a id=bmbxss href=javascript:..."    |
| noUncaughtExceptions   | stop    |    28 |         38 | Click "button||Apply|0"                    |
| cartTotalAddsUp        | stop    |    16 |         25 | type "=]7oi&~u@Mr*$..."                    |
| escapeClosesDialogs    | stop    |     8 |        287 | key 27                                     |
```

Exploration is random: a single two-minute run usually finds five or six of the six seeded bugs,
and the stuck checkout spinner shows up within a few runs. Then `pnpm demo:fixed` serves the same
app with the bugs off and the same spec stays silent (about 850 states, exit 0). `pnpm verify` runs both,
with the rest of the gate, before every release.

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

Run it at the end of every agent session, as a pre-commit hook, or in CI against the target branch.

## What we measured

We gave fresh agents the same tasks with and without the skills, two replicates each, and scored
their suites with the bundled mutation tester ([full results](evals/results/2026-10-12-agent-tests.md)).

- On small, clearly specified modules the model already wrote strong tests: 98-100% mutation
  scores, hand-rolled fakes instead of mocks, and code fixes instead of bent tests, with or
  without the skills.
- With the skills, agents measured their own work: they ran the audit, the mutants and the guard,
  explained the one equivalent mutant, and flagged a test edit for review with its justification.
  That took about twice the wall time.
- So the claim is not "higher scores". It is evidence: every green suite comes with proof that it
  can fail, and the scripts check any author's tests in CI. Harder fixtures are the next eval.

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

Profiles, from a clone (membership in [`profiles.json`](profiles.json)):

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
- The test audit reports no findings on a 199-file production suite it was not written for.

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
