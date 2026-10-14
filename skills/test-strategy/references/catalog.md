# Catalog of test types

Every common kind of test, what risk it covers, where it runs, and which skill holds its
mechanics. Names vary between teams; match by what the test does, not what it is called.

## Correctness

| Test type | Catches | Runs | Skill |
| --- | --- | --- | --- |
| Unit | Wrong rules, parsing, arithmetic, state transitions in pure code | Every change | `test-unit` |
| Table-driven or parameterized | The same rule across many named cases | Every change | `test-unit` |
| Property-based | Edge cases nobody listed; invariants, round trips, oracles | Every change, more runs scheduled | `test-properties` |
| Model-based (stateful) | Stateful bugs in caches, carts, editors, protocols | Every change | `test-properties`; `test-explore` for a live UI |
| Metamorphic | Bugs where no expected output is known (pricing, search, numeric code) | Every change | `test-properties` |
| Differential | A rewrite, port or optimization that changed behavior | Every change during the migration | `test-properties` |
| Fuzzing (coverage-guided) | Crashes, hangs and memory errors deep in parsers and decoders | Corpus every change, fuzzing scheduled | `test-properties` |
| Snapshot, golden, approval | Unreviewed changes in wide outputs (rendered text, generated code) | Every change; every diff reviewed | `test-unit`, `test-guard`; `test-component` (ARIA or inline snapshots), `test-visual` (screenshots) |
| Component | Rendering, interaction, loading, empty and error states of a UI component | Every change | `test-component` |
| Integration | Behavior against a real database, queue, cache, file store or HTTP server | Every change for the core, scheduled for slow engines | `test-integration` |
| Contract (consumer-driven or schema) | Drift between a client and the service or event it depends on | Every change on both sides | `test-integration` |
| System test without a UI (API, CLI, worker across services) | A flow broken between services that no UI test reaches | Every change (core flows) or nightly | `test-integration` |
| Migration rehearsal | Data loss or downtime from a schema or data migration | Before each migration, on production-like data | `test-integration` |
| End-to-end tour | A critical user path broken anywhere in the stack | Every change (smoke subset) or nightly | `test-e2e` |
| Smoke and sanity | A deploy that does not start or serve its main page | After each deploy | `test-e2e` (post-deploy smoke) |
| Exploration, monkey | Rules broken on paths nobody scripted | Scheduled campaigns, short smoke per change | `test-explore` |
| Acceptance, BDD | Behavior that does not match an agreed business example | Every change | `test-e2e` or `test-unit`, at the lowest layer that shows it |
| Policy, architecture | Import boundaries, i18n parity, banned patterns, docs drift | Every change | `test-policy` |
| Localization | Missing or overflowing translations, wrong formats per locale | Every change (parity), scheduled (layout per locale) | `test-policy`, `test-explore` |

## Quality attributes

| Test type | Catches | Runs | Skill |
| --- | --- | --- | --- |
| Accessibility | Unusable by keyboard or screen reader; contrast, labels, focus | Every change (scans and keyboard tests), manual smoke per release | `test-accessibility` |
| Visual regression | Layout and styling changes nobody intended | Every change on stable components | `test-visual` |
| Micro-benchmark | A hot function that got slower | Scheduled or on demand, same machine | `test-performance` |
| Scaling or operation-count | Quadratic algorithms, N+1 queries | Every change (deterministic) | `test-performance` |
| Load, stress, soak, spike | Latency and errors under traffic; leaks over hours | Scheduled against a production-like environment | `test-performance` |
| Frontend budgets | Bundle size, Core Web Vitals in the lab, long tasks, memory growth | Every change (size), scheduled (lab metrics) | `test-performance` |
| Security (application) | Broken authorization, injection, unsafe rendering, replay | Every change | `test-security` |
| Security (supply chain, static) | Vulnerable dependencies, secrets, dangerous patterns | Every change via scanners | `test-security` (scope note only), the scanner's own docs |
| Resilience, fault injection | Timeouts, retries, partial failures, double effects | Every change at boundaries | `test-integration` for fault injection at boundaries; chaos experiments in production-like environments are beyond these skills |
| Compatibility | Browser, device, OS or runtime version differences | Scheduled matrix; per change on the primary target | `test-e2e`, `test-visual`; runtime and library version matrices run the existing suites in the CI matrix |
| Language-model features | Prompt, retrieval, structured output and tool-use regressions | Mocked tests every change; evaluation suites on prompt or model changes | `test-llm` |

## Test quality and operations

| Practice | Catches | Runs | Skill |
| --- | --- | --- | --- |
| Test audit | Tests that cannot fail: no assertions, tautologies, mocks of the unit | Every change on new tests | `test-audit` |
| Mutation testing | Code that runs under tests but no assertion guards | Changed files per change, full scheduled | `test-audit` |
| Weakening guard | Deleted, skipped or loosened tests in a change | Every change | `test-guard` |
| Flakiness measurement | Intermittent failures and their source | When a test fails intermittently; scheduled repeat runs | `test-flaky` |
| Finding triage | Violations and failures turned into fixed bugs or corrected checks | After any failing run | `test-findings` |

## In production

Canary releases, feature-flag rollouts, synthetic monitoring and A/B experiments test with real
traffic. They complement, never replace, pre-merge tests: they catch environment and data
differences, and they need the same discipline (an oracle, a threshold measured from baseline,
an automatic rollback or alert). Plan them in the strategy table with their owner and signal.

## Manual testing

Exploratory sessions by a person, usability studies and screen reader walkthroughs find what no
oracle encodes. Time-box them with a charter ("try to break checkout with slow networks"), log
what was tried, and turn every bug found into an automated test at the lowest layer that shows it.
