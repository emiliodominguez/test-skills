# Accessibility checks and snapshots

## axe-core inside component tests

Run axe on the rendered container in every state that matters (closed and open menu, empty and
error, invalid form), not only after the first render.

```ts
async function axeViolations(container: Element): Promise<string[]> {
	const results = await axe.run(container, {
		runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
		rules: { "color-contrast": { enabled: false } },
	});

	return results.violations.map(function toId(violation) {
		return violation.id;
	});
}

expect(await axeViolations(container)).toEqual([]);
```

- Assert the list of rule ids equals `[]`, so a failure names every rule at once. `jest-axe` and
  `vitest-axe` wrap the same call with a matcher.
- **Color contrast needs a browser.** Measured with axe-core 4.14 in jsdom 30: light gray text
  on white is not a violation; the rule lands in `incomplete` because axe cannot get a canvas or
  layout. Disable the rule in jsdom runs and check contrast in a browser runner.
- **axe does not see behavior.** Measured in this repository: a mouse-only `span` with a click
  handler passed axe with zero violations; the role query and the keyboard test caught it. Keep
  role queries and a keyboard path in the tests; axe complements them.
- Do not run several `axe.run` calls in parallel in one document; axe refuses concurrent runs.
- Known violations go in an explicit allowlist of rule id plus selector with a reason, never a
  blanket `disableRules`.

Page-level audits, screen reader behavior and focus order across a whole flow belong to
`test-accessibility`.

## Keyboard and focus

For each interactive component, one test drives it without a pointer:

- `await user.tab()` reaches the control in a sensible order; `document.activeElement` is the
  element you found by role.
- Enter submits forms and activates buttons and links; Space toggles checkboxes and buttons;
  Escape closes dialogs and popovers; arrow keys move within menus, tabs, listboxes and grids.
- Opening a dialog moves focus inside it; closing it returns focus to the trigger.

`fireEvent.keyDown` dispatches one event and runs no default action: measured in this
repository, Enter in a field submitted nothing even on the working form, while user-event's
`{Enter}` submitted it.

## Snapshots

Use a snapshot only for small, stable output that a reviewer can read in the diff: a formatted
string, a short ARIA snapshot of one widget, a serialized object of a few lines. Prefer inline
snapshots so the expected value sits in the test.

- No whole-component DOM snapshots. They break on every markup change, reviewers accept the
  update without reading it, and they assert nothing about behavior.
- A snapshot update is a code change: read every changed line, and update only when the meaning
  changed.
- Pixel comparisons belong to `test-visual`, in a real browser with fixed fonts and data.
