---
name: test-strategy
description: "Test strategy that maps risks to test layers and oracles. Use when planning tests for a feature or repository, auditing a suite, or deciding where a check belongs. Routes to `test-unit`, `test-e2e`, `test-bombadil`, `test-policy` or `test-security`."
metadata:
  stage: plan
---

# Test strategy

Decide which risks the suite must catch, which layer catches each one, and what judges a
result correct. A strategy is a table of risks, not a pyramid quota.

## Process

1. **Inventory.** Read the test config, runners, scripts, fixtures, helpers, CI workflows and
   any testing guide. Record what runs on every change, what runs on a schedule and what only
   runs by hand. A suite nobody runs is not coverage.
2. **List the risks.** For the change or the product area: wrong numbers, wrong permissions,
   invalid input reaching storage, broken flows, layout and accessibility regressions, leaks,
   slow or chatty screens, unsafe rendering, convention drift. Name the observable symptom of each.
3. **Assign a layer per risk.**

   | Risk | Layer | Skill |
   | --- | --- | --- |
   | Pure rules, parsing, arithmetic, state transitions | Unit tests on the pure core, table-driven | `test-unit` |
   | Wide input spaces: parsers, money, dates, serializers | Property-based tests with shrinking | `test-properties` |
   | A boundary rejects bad input; failures map to the right response | Unit or in-process flow tests | `test-unit` |
   | A critical path someone can write down | Scripted end-to-end tour | `test-e2e` |
   | Invariants on paths nobody wrote down | Property-based UI exploration | `test-bombadil` |
   | Architecture, i18n, docs and naming conventions | Repository-reading policy tests | `test-policy` |
   | Authorization, hostile payloads, renderer hardening | Schema-driven security tests | `test-security` |
   | Tests that cannot fail, or were weakened by a change | Static audit, mutants and a diff guard | `test-audit`, `test-guard` |
   | Intermittent failures | Measured repetition and a named source | `test-flaky` |

   Scripted tours and exploration are complementary: tours prove the paths you know, exploration
   checks invariants on the paths you did not think of. Neither replaces the other.
4. **Pick the oracle.** Prefer the system's own pure code as the oracle (its parser decides what
   is valid, its permission function decides what a role may see), cross-checked by an
   independently written table where a shared bug would hide. Use golden files only for wide
   outputs whose every changed line someone will review.
5. **Split measuring from deciding.** Checks that decide correctness (totals add up, a role
   cannot reach a screen) fail the run. Checks that measure (latency, accessibility scan counts,
   call volume, memory growth) are recorded and triaged in batches. Thresholds for measurements
   come from observed runs, typically twice the observed maximum, never from a guess.
6. **Define coverage as reached checks.** Line coverage shows unexercised code. For properties,
   count the states where each check had data to judge; a property that never reached its
   screen checked nothing. Steer effort toward unreached checks.
7. **Write the maintenance contract.** A short table in the repository: "when the application
   gains X, update Y". New totals, filters, gated forms, routes, permissions and procedures each
   name the test that must change with them, and the review checklist asks for it.

## Output

A table of risk, layer, oracle, where it runs (every change, scheduled, manual), and the gap or
next action. Name the commands. Mark anything you inferred rather than ran.

## Anti-patterns

- A coverage percentage target as the strategy.
- Mocking the unit under test, or testing getters and storage round trips.
- An end-to-end tour for logic a table-driven unit test covers in milliseconds.
- One flaky layer retried until green instead of made deterministic.
- Thresholds copied from a blog post instead of measured on this system.

## Done when

- Every listed risk has a layer, an oracle and a run cadence, or is marked as an accepted gap.
- The maintenance contract exists or the missing entries are listed.
- Commands that were run, and those that could not run, are stated.

Route the work to `test-unit`, `test-e2e`, `test-bombadil`, `test-policy` or `test-security`.
