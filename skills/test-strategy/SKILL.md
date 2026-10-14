---
name: test-strategy
description: "Test strategy that maps risks to test types, layers and oracles. Use when planning tests for a feature or repository, choosing what kind of test to write, or auditing coverage gaps. Routes to the testing skills, starting with `test-unit`."
metadata:
  stage: plan
---

# Test strategy

Decide which risks the suite must catch, which kind of test catches each one, and what judges a
result correct. A strategy is a table of risks, not a pyramid quota or a coverage percentage.

## Process

1. **Inventory.** Read the test config, runners, scripts, fixtures, helpers, CI workflows and
   any testing guide. Record what runs on every change, what runs on a schedule and what only
   runs by hand. A suite nobody runs is not coverage.
2. **List the risks.** For the change or the product area: wrong numbers, wrong permissions,
   invalid input reaching storage, broken flows, contract drift between services, slow or
   chatty screens, inaccessible controls, visual regressions, unsafe rendering, model output
   regressions, convention drift. Name the observable symptom of each.
3. **Assign a test type and layer per risk.** Route each to the skill that owns it:

   | Risk | Test type | Skill |
   | --- | --- | --- |
   | Pure rules, parsing, arithmetic, state transitions | Unit tests on the pure core, table-driven | `test-unit` |
   | Wide input spaces, stateful logic, unknown expected outputs | Property-based, model-based, metamorphic; fuzzing for parsers | `test-properties` |
   | A component renders, responds to users and handles loading and errors | Component tests through roles and user events | `test-component` |
   | Real database, queue, cache or HTTP behavior; contracts between services; faults at boundaries | Integration and contract tests | `test-integration` |
   | A critical path someone can write down | Scripted end-to-end tour | `test-e2e` |
   | Rules on paths nobody wrote down | Autonomous UI exploration | `test-explore` |
   | Keyboard, screen reader, contrast, WCAG | Accessibility scans plus keyboard tests | `test-accessibility` |
   | Layout and styling regressions | Visual regression screenshots | `test-visual` |
   | Latency, throughput, scaling, bundle and memory budgets | Benchmarks, scaling tests, load tests | `test-performance` |
   | Authorization, hostile payloads, renderer hardening | Schema-driven security tests | `test-security` |
   | Prompts, retrieval, structured output, agent tool use | Mocked-model tests and evaluation suites | `test-llm` |
   | Architecture, i18n, docs and naming conventions | Repository-reading policy tests | `test-policy` |
   | Tests that cannot fail, or were weakened by a change | Static audit, mutants and a diff guard | `test-audit`, `test-guard` |
   | Intermittent failures | Measured repetition and a named source | `test-flaky` |

   For test types outside this table (smoke, canary, synthetic monitoring, migration rehearsal,
   compatibility matrices, chaos, acceptance), read [references/catalog.md](references/catalog.md):
   it maps each one to where it runs and which skill covers its mechanics.
4. **Pick the lowest layer that can show the failure.** A rule checked by a unit test in
   milliseconds does not need a browser; a contract between two services cannot be shown by
   either service's unit tests. Scripted tours and exploration are complementary: tours prove the
   paths you know, exploration checks rules on the paths you did not think of.
5. **Pick the oracle.** Prefer the system's own pure code as the oracle (its parser decides what
   is valid, its permission function decides what a role may see), cross-checked by an
   independently written table where a shared bug would hide. Use relations (metamorphic,
   round trip) when no expected output exists, and golden files only for wide outputs whose
   every changed line someone reviews.
6. **Split measuring from deciding.** Checks that decide correctness (totals add up, a role
   cannot reach a screen) fail the run. Checks that measure (latency, accessibility scan counts,
   evaluation scores, memory growth) are recorded and triaged in batches, with thresholds set from
   observed runs, typically twice the observed maximum, never from a guess.
7. **Define coverage as reached checks.** Line coverage shows unexercised code; mutation score
   (`test-audit`) shows exercised code no assertion guards. For properties, count the states where
   each check had data to judge. Steer effort toward unreached checks and surviving mutants.
8. **Write the maintenance contract.** A short table in the repository: "when the application
   gains X, update Y". New totals, filters, gated forms, routes, permissions, endpoints, prompts
   and events each name the test that must change with them, and the review checklist asks for
   it.

## Output

A table of risk, test type, layer, oracle, where it runs (every change, scheduled, manual), and
the gap or next action. Name the commands. Mark anything you inferred rather than ran.

## Anti-patterns

- A coverage percentage target as the strategy.
- Mocking the unit under test, testing getters, or round trips through storage code you do not
  own (an ORM save then load).
- An end-to-end tour for logic a table-driven unit test covers in milliseconds.
- Mocks standing in for a database or a partner service whose behavior is the risk.
- One flaky layer retried until green instead of made deterministic.
- Thresholds copied from a blog post instead of measured on this system.

## Done when

- Every listed risk has a test type, a layer, an oracle and a run cadence, or is marked as an
  accepted gap.
- The maintenance contract exists or the missing entries are listed.
- Commands that were run, and those that could not run, are stated.

Start the work with `test-unit` for pure rules, or with the skill the table names for each risk.
