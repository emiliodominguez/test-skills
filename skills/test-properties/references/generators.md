# Generators

A property is only as good as the inputs it sees. Generators decide whether a hundred runs reach
the edge cases or spend themselves on uninteresting values.

## Build from the domain

- **Compose, do not filter.** `fc.integer({ min: 1, max: 50 })` instead of filtering
  `fc.integer()` down to that range; in Hypothesis, `st.integers(1, 50)` instead of `assume`. A filter that rejects more than about half the values slows the search and can make
  Hypothesis raise a health-check error.
- **Generate valid structures, then render them.** Generate an order object and serialize it,
  rather than generating JSON text and hoping it parses.
- **Derive dependent values.** Generate a list, then an index into it:

  ```ts
  const listAndIndex = fc.array(item, { minLength: 1 }).chain(function withIndex(list) {
  	return fc.tuple(fc.constant(list), fc.nat({ max: list.length - 1 }));
  });
  ```

  In Hypothesis, use `st.data()` or a `@composite` strategy.
- **Mix in near misses.** `fc.oneof(validEmail, nearlyValidEmail)` keeps both the success path and
  the refusal path exercised.

## Reach the edges

| Domain | Make sure the generator can produce |
| --- | --- |
| Integers | 0, 1, -1, the type's bounds, values around thresholds in the code |
| Money | 0, one cent, amounts that do not divide evenly, maximum supported amount |
| Floats | NaN, ±Infinity, -0, subnormals, very large and very small values (or exclude them deliberately) |
| Strings | Empty, whitespace only, very long, unicode (combining marks, emoji, right-to-left), control characters, quotes and separators of the format |
| Dates | Month ends, leap days, DST transitions, time zones with odd offsets, epoch boundaries, far past and future |
| Collections | Empty, one element, duplicates, already sorted, reverse sorted |
| Identifiers | Collisions, case-only differences, unicode lookalikes |

Libraries bias toward small and boundary values already; thresholds specific to the code
(tiers, limits, page sizes) need explicit `fc.constantFrom` or `st.sampled_from` mixed in.

## Size and speed

Keep generated structures small (a few elements, short strings): most bugs have small
counterexamples, and shrinking is faster from small values. Raise sizes in a scheduled job, not
on every change. Recursive data needs an explicit depth limit (`fc.letrec` with `depthSize`,
Hypothesis `st.recursive` with `max_leaves`).

## Determinism

The generator is the only source of randomness. Never call `Math.random`, `Date.now` or
`uuid()` inside a property: generate the seed, time or id instead and pass it in, so a recorded
seed replays the failure exactly.

## Reuse

Put domain generators in one module next to the tests (`arbitraries.ts`, `strategies.py`) and
reuse them across properties, fixtures and the fuzzing corpus. A good generator is project
infrastructure; review it like code.
