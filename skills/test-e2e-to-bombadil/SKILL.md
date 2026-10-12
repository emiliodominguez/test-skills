---
name: test-e2e-to-bombadil
description: "Turns scripted end-to-end tests into Bombadil properties and workflow generators, so each assertion holds on every path instead of one. Use when a project has Playwright or Cypress tests and wants autonomous exploration. Hands off to `test-bombadil-spec` and `test-bombadil`."
compatibility: "Bombadil 0.7.x; reads Playwright, Cypress or similar end-to-end suites."
metadata:
  stage: author
---

# From end-to-end tests to properties

An end-to-end test checks one path someone wrote down. Most of its assertions are really rules
that should hold on every path. Lift those rules into properties, turn the scripted steps into
workflow generators, and let exploration find the paths nobody wrote.

## Process

1. **Inventory the suite.** For each test, list its steps and its assertions. Keep the scripted
   tests; this adds a layer, it does not replace one.
2. **Classify each assertion:**

   | Assertion in the script | Becomes |
   | --- | --- |
   | "Total shows $12.50 after adding two mugs" | Invariant: the total equals the sum of displayed lines, in every state |
   | "Error appears for an invalid email" | Guarantee: an invalid value in a field implies an error within N seconds, and no submit |
   | "Spinner disappears after save" | Bounded guarantee: every busy indicator clears within N seconds |
   | "Dialog closes on Cancel" | `next`: after Cancel or Escape, the dialog is gone |
   | "Admin sees the Billing link" | Invariant: visible navigation equals what the role's permissions grant |
   | "Item count badge says 3" | Invariant: the badge equals the number of rows |
   | "Page has the title X" | Usually stays a scripted check; it is a path fact, not a rule |

   Keep path facts in the scripted test. Lift rules.
3. **Write each lifted rule as a property** with an extractor that reads the same elements the
   script located. Reuse the script's locators (role and accessible name, label, test id) in
   the extractor so both layers break together when the markup changes.
4. **Turn multi-step flows into workflow generators.** Steps random clicks rarely complete
   (sign in, fill a form in order, choose from a custom select, confirm a dialog) become a small
   state machine: offer the next step based on what the screen shows, with momentum while a flow
   is in progress. Sign-in becomes a gated action with demo credentials typed as escaped literals.
5. **Reuse fixtures.** Seeded data, fake services, auth state and the dev server command from the
   end-to-end setup become the Bombadil run's setup. Inject the page kit the same way the suite
   injects test hooks.
6. **Verify the lift.** Run the spec on the current build: every lifted property must be silent
   and reached. Then reintroduce one bug the scripted test once caught (or revert its fix in a
   scratch branch) and confirm a property catches it without the script.

## Example

```ts
// Scripted: after adding two mugs, the total reads $25.80.
// Lifted: in every state, the total equals the sum of the line amounts.
export const cartTotalAddsUp = settles(function addsUp() {
	const { lines, total } = cart.current;

	return total === null || total === lines.reduce(function sum(acc, line) {
		return acc + line;
	}, 0);
});
```

## Anti-patterns

- Converting every scripted step into a hard-coded action sequence: that is the same script, slower.
- Lifting path facts ("the third row is Mugs") into invariants that fail on every other path.
- Deleting the scripted tests after the lift.
- Properties that read different elements than the scripted test, so one layer rots silently.

## Done when

- Each scripted assertion is marked lifted (with its property) or kept as a path fact.
- Lifted properties are silent and reached on the current build.
- At least one historical bug is caught by a property without the script.

Write and tune the properties with `test-bombadil-spec`; run them with `test-bombadil`.
