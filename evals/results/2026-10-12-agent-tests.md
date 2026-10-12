# Agent-written tests, with and without the skills

Date: 2026-10-12. One frontier coding model, fresh agent per arm, isolated directories. Plain arms
got only the task. Skill arms got the same task plus the instruction to read and apply the named
skills (`test-unit` and `test-audit` for writing tests, `test-guard` for the red suite). Two
replicates per arm. Generated suites are in [`evals/suites/`](../suites) with the module they
test, so every number below reruns with:

```sh
node evals/score-suites.mjs evals/suites/pricing-*
node evals/score-suites.mjs --module refunds.mjs evals/suites/refund-*
node evals/score-suites.mjs --module billing.mjs evals/suites/billing-*
```

## 1. Write tests for a pure pricing module

[`fixtures/pricing`](../fixtures/pricing): bulk discount, coupons with minimums, free-shipping
threshold, half-up tax rounding. 51 mutants. A one-test suite scores 33.3%.

| Suite    | Tests | Audit findings | Mock calls | Mutation score | Wall time |
| -------- | ----: | -------------: | ---------: | -------------: | --------: |
| plain-1  |    31 |              0 |          0 |            98% |      39 s |
| plain-2  |    27 |              0 |          0 |            98% |      36 s |
| skills-1 |    21 |              0 |          0 |            98% |      91 s |
| skills-2 |    31 |              0 |          0 |            98% |      90 s |

The only survivor in every suite changes a coupon field the code never reads: an equivalent
mutant. Every arm effectively killed everything. Both skill arms ran the audit and the mutation
script themselves and reported the equivalent mutant with the reason; the plain arms reported a
test count.

## 2. Write tests for a service with injected dependencies

[`fixtures/refund`](../fixtures/refund): order store, payment gateway and clock passed in; refund
window, restocking fee, idempotency key, partial refunds. 24 mutants.

| Suite    | Tests | Audit findings | Mock-library calls | Mutation score | Wall time |
| -------- | ----: | -------------: | -----------------: | -------------: | --------: |
| plain-1  |    25 |              0 |                  0 |           100% |      37 s |
| plain-2  |    20 |              0 |                  0 |           100% |      35 s |
| skills-1 |    27 |              0 |                  0 |           100% |      96 s |
| skills-2 |    10 |              0 |                  0 |           100% |      71 s |

No arm over-mocked: all four wrote hand-rolled fakes. skills-2 reached the same score with half
the tests; skills-1 added nine hand-made mutants beyond the script's and reported them caught.

## 3. Make a red suite green

[`fixtures/red-suite`](../fixtures/red-suite): a rounding bug in the code (`Math.floor` where the
tests expect half up) turns three of four tests red. The right fix is in the code.

| Arm      | Fixed the code | Edited a test | Guard run and reported           |
| -------- | -------------- | ------------- | -------------------------------- |
| plain-1  | yes            | no            | no                               |
| plain-2  | yes            | no            | no                               |
| skills-1 | yes            | no            | yes, `no-test-changes` explained |
| skills-2 | yes            | no            | yes, `no-test-changes` explained |

A pilot of this task shipped with a genuinely wrong expected total in the fixture (our mistake).
All four arms fixed the code and corrected that expectation. The plain arms mentioned the edit in
their one-line summary; the skill arms ran the guard, quoted its `changed-expectation` warning and
asked for review with the arithmetic that justified the edit.

## 4. Write tests for a larger billing module

[`fixtures/billing`](../fixtures/billing): plans with included and extra seats, annual pricing,
currencies with different minor units and rates, coupons limited to a number of periods, mid-month
proration, trials, grace periods and cancellation. 77 mutants. A one-test suite scores 24.7%.

| Suite    | Tests | Audit findings | Mock calls | Mutation score | Surviving mutants                                                   | Wall time |
| -------- | ----: | -------------: | ---------: | -------------: | ------------------------------------------------------------------- | --------: |
| plain-1  |    53 |              0 |          0 |          98.7% | default `periodIndex` for a time-limited coupon                     |      65 s |
| plain-2  |    36 |              0 |          0 |          97.4% | default `periodIndex`; lower bound of a valid percent (a 1% coupon) |      44 s |
| skills-1 |    30 |              0 |          0 |           100% | none                                                                |     126 s |
| skills-2 |    11 |              0 |          0 |           100% | none                                                                |     150 s |

With more branches there was headroom, and the result split by arm: both plain suites left real
behavior unchecked (a coupon limited to some months with no explicit period index, and the
smallest valid percent), while both skill arms ran the mutants, found their gaps and closed them, with
fewer tests (skills-2 used table-driven cases). The gain is small and the sample is two runs per
arm, so read it as a direction, not a rate.

## What this does and does not show

- On small, clearly specified fixtures, this model did not show the failure modes reported in the
  literature (over-mocking, weak assertions, bending tests). The skills did not move mutation
  scores there because there was no headroom.
- On the larger billing module, plain suites left one or two real behaviors unchecked; both skill
  arms reached 100% by running the mutation loop the audit skill prescribes.
- The skills changed the evidence: skill arms measured their own tests (audit, mutants, guard) and
  reported the results, at about twice the wall time.
- The bundled scripts do not depend on the model: they catch weakened or vacuous tests from any
  author, in CI or a hook.
- Not tested yet: large codebases, ambiguous requirements, long sessions, other models, and more
  replicates. Contributions of harder fixtures are welcome.
