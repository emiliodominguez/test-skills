---
name: test-properties
description: "Property-based testing and fuzzing: invariants, round trips, oracles, metamorphic and model-based tests with shrinking. Use when examples miss edge cases in parsers, money, dates or state. Hands off to `test-unit` or `test-findings`."
compatibility: "Patterns verified with fast-check 4.10 in this repository's examples; the same shapes apply to Hypothesis, jqwik, proptest, rapid, FsCheck and QuickCheck."
metadata:
  stage: author
---

# Property-based tests

State what must hold for every input, let a generator search for a counterexample, and let the
library shrink it to the smallest failing case. One property replaces dozens of examples and
finds the cases nobody listed. Success is a property that fails on a wrong implementation, with
a shrunk counterexample that replays from a seed.

## Process

1. **Use the ecosystem's library** if the repository has one; adding one is a dependency
   decision, so ask first:

   | Language | Library | Stateful testing |
   | --- | --- | --- |
   | JavaScript, TypeScript | fast-check | `fc.commands`, `fc.modelRun`, `fc.scheduler` for races |
   | Python | Hypothesis | `RuleBasedStateMachine`, `Bundle`, `@precondition` |
   | Java, Kotlin | jqwik (Kotest property tests for Kotlin) | jqwik action chains |
   | Rust | proptest (quickcheck for simple cases) | proptest-state-machine |
   | Go | rapid (`testing/quick` is frozen) | `t.Repeat` with an action map |
   | C#, F# | FsCheck (CsCheck) | FsCheck model-based |
   | Haskell, Erlang, Elixir | QuickCheck, PropEr, StreamData | `quickcheck-state-machine`, `proper_statem` |

   Without a library, a seeded loop over a small hand-written generator is a fine start, but it
   does not shrink.
2. **Find the property.** Pick the shape that fits the code; most modules have two or three:

   | Shape | Holds when | Catches |
   | --- | --- | --- |
   | Invariant | Allocated shares sum to the amount and differ by at most one | Lost or invented cents |
   | Round trip | `decode(encode(x)) == x` | Escaping, encoding, precision loss |
   | Oracle | The fast version equals a slow, obviously correct one | Optimizations that break edge cases |
   | Metamorphic | Adding an item never lowers the total; a stricter filter returns a subset | Bugs with no known expected output |
   | Idempotence | `normalize(normalize(x)) == normalize(x)`; a migration applied twice changes nothing | Repeated side effects |
   | Commutativity | Applying the same events in any order gives the same state | Order-dependent merges, sync conflicts |
   | Never crashes | Any input gives a value or a typed refusal | Unhandled exceptions at a boundary |
   | Model agreement | Random command sequences leave the system and a tiny model in the same state | Stateful bugs: caches, carts, editors, protocols |

   Read [references/patterns.md](references/patterns.md) for each shape with code in fast-check
   and Hypothesis, and for finding properties when the expected output is unknown.
3. **Generate from the domain.** Build values that reach the edges: zero, one, empty, maximum,
   negative, boundary dates, unicode, near misses one step from valid. Constrain by construction
   rather than `filter`, generate at the type the code receives at its boundary, and keep sizes
   small enough to stay fast. Read [references/generators.md](references/generators.md) before
   writing a non-trivial generator.
4. **Prove the property can fail.** Break the implementation on purpose (off by one, a dropped
   element, a skipped escape) and watch the property catch it. A property that passes on a broken
   implementation is decoration.
5. **Make failures replayable and permanent.** Print the seed and the shrunk counterexample; pin
   each counterexample as an ordinary example test before fixing it (Hypothesis `@example`,
   fast-check `examples` option or a plain test).
6. **Budget runs.** The library default (about 100 runs) on every change, more in a scheduled
   job. No I/O inside the generated loop; isolate the pure core or use in-memory fakes.

## Stateful and model-based testing

For anything with state, generate sequences of commands, apply each to the real system and to
a model a few lines long, and compare after every step. The shrunk sequence is the bug report.
Read [references/stateful.md](references/stateful.md) for commands, preconditions, models,
parallel and race testing. For user interfaces the same idea runs against a live page: see
`test-explore`.

## Fuzzing

Coverage-guided fuzzers (Jazzer.js, Atheris, Go's native fuzzing, cargo-fuzz, libFuzzer, AFL++)
mutate bytes toward new code paths for hours, which suits parsers, decoders and native code where
crashes and sanitizer reports are the oracle. Property-based tests run in seconds on every change
with domain-shaped inputs and semantic oracles. Use both on a parser: properties in the suite,
a fuzzer on a schedule seeded with the property generators' corpus. For HTTP APIs, generate
requests from the OpenAPI or GraphQL schema (Schemathesis). Read
[references/fuzzing.md](references/fuzzing.md) to set one up.

## Measured in this repository

`test/properties-examples.test.ts` runs each shape against a module with a realistic bug that an
example test misses: allocation (invariant, shrunk to `allocate(1, 2)`), CSV (round trip, shrunk
to one field holding `"`), an LRU cache (model-based, five commands or fewer), a tiered discount
(metamorphic, no expected totals needed) and an insertion sort (oracle, two elements). Each
property passes on the fixed module.

## Anti-patterns

- Restating the implementation inside the property: it passes with the same bug.
- Properties so weak that any output passes, such as "returns a string" or "does not throw" on
  code that cannot throw.
- `filter` that discards most generated values, or unbounded generators that make runs slow.
- Runtime randomness or the clock inside a property: failures stop replaying.
- Discarding a found counterexample instead of pinning it as an example test.
- Raising the run count to hunt for a bug a better generator would reach in a hundred runs.

## Done when

- Each property was shown to fail on a deliberately wrong implementation.
- Failures print a seed and a shrunk counterexample that replay.
- Found counterexamples are pinned as example tests and fixed or reported.
- The run budget per change and on schedule is stated.

Pin found cases with `test-unit`; triage surprising counterexamples with `test-findings`.
