---
name: test-bombadil-spec
description: "Bombadil specifications: extractors, temporal properties and replayable action generators. Use when writing or fixing Bombadil properties, actions or input value sets. Hands off to `test-bombadil` to run them or `test-findings` to triage violations."
compatibility: "Bombadil 0.7.x specification API (@antithesishq/bombadil)."
metadata:
  stage: author
---

# Bombadil specifications

A specification is an ES module that exports only properties (formulas) and action generators.
Properties state what must hold whatever the user did; generators decide what the user can do
next. Both must be cheap, deterministic and replayable.

## Layout

```text
tests/bombadil/
  explore.ts            top-level spec: export * from "./lib/properties.ts" + one generator mix
  checkout.ts           area spec: same properties, a mix weighted toward that area
  lib/properties.ts     re-exports every property, then the Bombadil defaults
  lib/<area>.ts         extractors and properties per concern
  lib/dom.ts            screen-reading helpers
  lib/actions.ts        generators
  lib/values.ts         regex value sets, computed at bundle time where needed
  policy.json           finding policy
```

Type-check the specs in the main typecheck gate. Keep pure step logic (progress tracking,
weights) free of Bombadil imports so it is unit-testable in Node.

## Writing a property

1. Read the screen in an `extract` callback and return plain JSON: only what the formula needs,
   ideally only the suspects. Strip lone surrogates from strings.
2. Return `null` (and let the property pass) while the data is not judgeable: loading
   (`aria-busy`), an error alert shown, the element absent, the control inert.
3. Find elements by role, accessible name, header text from the translation catalog, or a test
   id. A renamed class or message key silently disables a property; prefer stable hooks and list
   the hooks each property depends on.
4. Pick the temporal shape. See [references/property-patterns.md](references/property-patterns.md):
   invariant, settles, bounded guarantee, `next` after an action, state machine, floor growth.
5. Use the app's own pure code as the oracle where possible, and an independently written table
   where a shared bug would hide.
6. Export it with a name that reads as the rule (`cartTotalAddsUp`, `escapeClosesDialogs`), add it to
   the spec's reach list, and decide its policy: `stop` if it decides correctness, `record` if it
   measures.
7. Run the covering spec 3-5 minutes with keep-going on a correct app: it must stay silent and
   show as reached.

Before writing generic checks from scratch, read
[references/property-library.md](references/property-library.md): text sanity, layout and
accessibility, memory, network and injection properties that apply to most apps.

## Writing actions

Read [references/action-patterns.md](references/action-patterns.md) before adding generators.
The rules that keep runs replayable and productive:

- Offer only actions valid in the current state; return `[]` otherwise.
- Always export something that can return `"Wait"`, or the run stops when nothing else applies.
- Gate everything except sign-in until someone is signed in, and keep random typing away from
  credential fields, or the run locks itself out.
- All typed text comes from Bombadil's string generators (regex for anything with meaning),
  never from runtime randomness.
- Weight generators with `weighted([[w, gen], ...])`; never filter by history, only reweight.
- Drive multi-step workflows as small state machines chosen from what the screen shows.

## Anti-patterns

- A property that reads the DOM inside the formula instead of through an extractor.
- `eventually` without `.within(...)`.
- A property that fails while a list refetches; use the settles pattern.
- Exporting helpers, constants or values from the top-level spec; only formulas and generators.
- Text built with `Math.random` or from page state, or value sets that call valid input a mistake.
- A property added straight to a long campaign without a silent covering run.

## Done when

- Each new property has a policy, is in the reach list, stayed silent on a correct app and was
  reached in a recorded run.
- Each new generator replays: a reproduce of a run that used it matches.
- The hooks each property depends on are named, so a rename is caught in review.

Run them with `test-bombadil`; triage violations with `test-findings`.
