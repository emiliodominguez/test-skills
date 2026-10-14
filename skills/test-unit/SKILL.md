---
name: test-unit
description: "High-signal unit and in-process flow tests. Use when testing domain logic, parsers, validators or service flows, or replacing mock-heavy tests. Hands off to `test-properties` or `test-integration`."
metadata:
  stage: author
---

# Unit tests

Test behavior and state changes at the lowest level that exercises the real failure. Most
tests hit the pure core with plain inputs and no mocks; a few run a real flow end to end in
process.

## Process

1. Read the code, its callers and the existing helpers. Reuse the harness, fixtures and fakes
   the repository already has before writing new ones.
2. Choose the shape:
   - **Pure rule:** a table of inputs and expected outputs, co-located with the code.
   - **Property over many inputs:** a small exhaustive generator (every single-digit change of a
     valid code, every transposition), or a property-based test with shrinking (`test-properties`).
   - **Boundary:** one test per boundary proving invalid input is rejected before any service runs.
   - **Typed failures:** every failure kind gets a test proving it maps to the right response code.
   - **Flow:** an in-memory system through the real router or dispatcher, with fakes that speak
     the real protocol and fail by name.
3. Write assertions that a wrong result would break. Prefer the idioms below.
4. Run the targeted tests, confirm they were discovered, and prove at least one fails for the
   right reason: against the old code, or by breaking the behavior temporarily.

## Idioms that keep tests honest

- **Collect offenders, expect empty.** `expect(variants.filter(isWrong)).toEqual([])` reports
  every offender at once and avoids conditional assertions.
- **Idempotence.** Parsing or normalizing an already-normalized value changes nothing.
- **Never-accepts tables.** Blank, wrong check digit, look-alike characters (letter O for zero),
  wrong types (number, null, object): each must be refused.
- **Exhaustiveness at compile time.** Type the failure table as a mapped type over every
  `kind` in the failure union, so a new kind does not compile until it has a test and a message.
  Pair it with a `switch` ending in an exhaustive-never check.
- **Fail where it happens.** An `unwrap` helper that throws with the refusal attached beats three
  assertions that fail later with `undefined`.
- **Invariant helpers.** A harness method such as "debits equal credits" called after flows.

## Harness and data

- **Deterministic time and ids.** A test clock that advances a fixed step per read and has a
  settable business date; sequential id generators. No wall clock, no random ids.
- **Seed once, clone per test.** When seeding dominates test time, build the seeded store once
  per file, serialize it, and restore a copy per test.
- **Real-protocol fakes** for external services, with named failure modes (not sent, lost
  response, refused, internal, auth) instead of per-test mocks.
- **Scale data** through the real services with a fixed seed, never through raw inserts that
  skip invariants.
- **Golden files** only with an explicit regeneration switch and a rule that every changed line
  is reviewed. Regenerate only when the meaning changed, never to make a test pass.
- **Query-plan assertions** for every index added for a query, so a later change that stops
  using it fails a test.

## Anti-patterns

- Mocking the unit under test, or a mock that restates the implementation.
- Tests for trivial getters, plain assignments or storage round trips.
- `expect` inside `if`, or assertions with custom messages instead of offender lists.
- Snapshotting a large output nobody reads.
- A retry, or a sleep, to stabilize a unit test.

## Done when

- Each contract in scope has a test that fails on a meaningful violation, and one was shown failing.
- Runner output is recorded with the command and the discovered test count.
- Gaps (no fake for a service, an untestable boundary) are listed with the next action.

Continue with `test-properties` for wide input spaces, `test-integration` when the risk lives in a real dependency, `test-component` or `test-e2e` when it lives in the UI, and `test-policy` for repository rules.
