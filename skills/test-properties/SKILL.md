---
name: test-properties
description: "Property-based tests for logic: invariants, round trips, oracles and model-based state machines with shrinking. Use when parsers, money, dates, serializers or reducers take wide inputs and examples miss edge cases. Hands off to `test-unit` or `test-findings`."
metadata:
  stage: author
---

# Property-based tests

State what must hold for every input, let a generator search for a counterexample, and let the
library shrink it to the smallest failing case. One property replaces dozens of examples and
finds the cases nobody listed.

## Process

1. **Use the ecosystem's library** if the repository has one (fast-check for JavaScript and
   TypeScript, Hypothesis for Python, proptest or quickcheck for Rust, rapid or gopter for Go,
   jqwik for Java). Adding one is a dependency decision: ask first. Without one, a seeded loop
   over a small generator is a fine start.
2. **Find the property.** Pick the shape that fits the code:

   | Shape | Example |
   | --- | --- |
   | Round trip | `parse(format(x)) == x`; decode after encode; deserialize after serialize |
   | Invariant | Totals equal the sum of lines; a sorted list is ordered and a permutation of the input |
   | Idempotence | `normalize(normalize(x)) == normalize(x)`; applying a migration twice changes nothing |
   | Oracle | The optimized function equals the slow, obviously correct one |
   | Metamorphic | Adding an item never lowers the total; filtering twice equals filtering once |
   | Never crashes | Any input gives a value or a typed refusal, never an exception |
   | State machine | Random command sequences against the system and a simple model agree |

3. **Write generators that reach the edges.** Build them from the domain, not from raw strings:
   valid values with boundaries (zero, negative, maximum, empty, one element), plus near misses
   one step from valid. Constrain by construction (`filter` throws away most inputs and slows the
   search). Generate with the same types the code receives at its boundary.
4. **Assert precisely.** The property must fail for a wrong implementation. Write one obviously
   wrong variant (off by one, a dropped element) and check the property catches it.
5. **Make failures replayable.** Log or persist the seed and the shrunk counterexample, and
   commit each counterexample as an ordinary example test so it stays fixed.
6. **Budget runs.** The default run count (often 100) on every change; more runs in a scheduled
   job. Keep each property fast: no I/O in the generated loop.

## Model-based testing

For stateful code (carts, caches, editors, protocols), generate sequences of commands, apply
each to the real system and to a tiny in-memory model, and compare observable state after
every step. The shrunk failing sequence is the bug report. For user interfaces the same idea
runs in the browser with Bombadil; see `test-bombadil-spec`.

## Anti-patterns

- Restating the implementation inside the property: it passes with the same bug.
- Properties so weak that any output passes, such as "returns a string".
- Unbounded generators that make runs slow or nondeterministic without a seed.
- Discarding a found counterexample instead of committing it as a regression test.

## Done when

- Each property was shown to fail on a deliberately wrong implementation.
- Failures print a seed and a shrunk counterexample that replay.
- Found counterexamples are committed as example tests and fixed or reported.

Pin found cases with `test-unit`; triage surprising counterexamples with `test-findings`.
