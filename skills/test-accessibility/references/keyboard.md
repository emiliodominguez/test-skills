# Keyboard, focus and browser checks

Checks a rule engine cannot make, written for Playwright. Each was shown failing on a seeded bug
and passing on the fixed page in `examples/accessibility/verify.mjs` (Chromium, playwright-core
1.64), except where a section says otherwise. Press real keys: `element.focus()` and `click()`
skip the key handlers under test.

## Tab walk: reachability, order, no trap

```js
/**
 * Describe the focused element and whether it shows a focus indicator. Runs in the page.
 *
 * @returns {{ id: string, indicator: boolean } | null} Null when focus left the document.
 */
function readFocus() {
	const element = document.activeElement;

	if (!element || element === document.body) return null;

	const style = getComputedStyle(element);
	const outline = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;

	return { id: element.getAttribute("data-testid") || element.tagName.toLowerCase(), indicator: outline || style.boxShadow !== "none" };
}

/**
 * Press Tab from the top until focus leaves the document, recording every stop.
 *
 * @param {import("playwright-core").Page} page - A freshly loaded page.
 * @param {number} limit - Most presses; reaching it means a trap or a very long page.
 * @returns {Promise<Array<{ id: string, indicator: boolean }>>} Stops in order.
 */
async function tabWalk(page, limit = 50) {
	const stops = [];

	for (let press = 0; press < limit; press += 1) {
		await page.keyboard.press("Tab");
		const focus = await page.evaluate(readFocus);

		if (!focus) return stops;
		stops.push(focus);
	}

	const last = stops.slice(-5).map(function toId(stop) {
		return stop.id;
	});

	throw new Error(`focus never left the page after ${limit} Tab presses; last stops: ${last.join(" > ")}`);
}
```

- **Reachable and ordered:** the controls you expect, filtered from the walk, equal the expected
  list in reading order. A `div` with a click handler is missing from the walk and invisible to
  axe (measured).
- **No keyboard trap (2.1.2):** in headless Chromium, Tab past the last control moves focus out of
  the document, so a walk that ends is a walk without a trap. Hitting the limit is the failure.
- **Activation:** for each custom control, focus it with Tab and press Enter, then Space; both
  must act for a button, Enter for a link. `role="button"` alone gives neither.
- Locate the expected controls by role and name where the markup allows; the example uses test
  ids only because its seeded `div` has no role.

## Focus visible (2.4.7)

Every stop in the walk has `indicator: true` (measured: `outline: none` on `:focus` fails it).
The computed-style check misses an outline that is also present without focus, or one too faint
to see; for those, compare a screenshot of the element focused and blurred (`test-visual`) and
review the contrast of the ring against its background (1.4.11, not in axe).

## Dialogs: focus in, trapped, Escape, focus back (measured)

```js
/**
 * Where focus is relative to the dialog. Runs in the page.
 *
 * @returns {string} `inside`, or what holds focus outside.
 */
function focusLocation() {
	const element = document.activeElement;

	if (document.querySelector('[role="dialog"]').contains(element)) return "inside";

	return element ? element.getAttribute("data-testid") || element.tagName.toLowerCase() : "none";
}

/**
 * Open the dialog as a keyboard user: focus the trigger and press Enter.
 *
 * @param {import("playwright-core").Page} page - The page.
 */
async function openDialogByKeyboard(page) {
	await page.getByRole("button", { name: "Delete account" }).focus();
	await page.keyboard.press("Enter");
	await page.getByRole("dialog").waitFor();
}

/**
 * Focus moves into the dialog and stays there under Tab and Shift+Tab.
 *
 * @param {import("playwright-core").Page} page - The page.
 */
async function expectFocusTrapped(page) {
	await openDialogByKeyboard(page);
	expect(await page.evaluate(focusLocation)).toBe("inside");

	for (const key of ["Tab", "Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"]) {
		await page.keyboard.press(key);
		expect(await page.evaluate(focusLocation), `after ${key}`).toBe("inside");
	}
}
```

Press more keys than the dialog has controls, in both directions, so the wrap is exercised.
Then, each on a fresh page:

- Escape closes it: `await page.keyboard.press("Escape")`, then the dialog is hidden.
- Focus returns: after closing, `expect(page.getByRole("button", { name: "Delete account" })).toBeFocused()`.
- The background is inert: no Tab press lands outside, and a screen reader's virtual cursor
  cannot reach it (manual pass; `aria-modal` alone does not block it in every pairing).

A native `<dialog>` opened with `showModal()` makes the rest of the page inert and closes on
Escape, but it does not wrap Tab: past its last control, focus moves to the browser's own UI and
`document.activeElement` reads `body`. That is the platform's behavior, not a trap failure, so the
`focusLocation() === "inside"` loop above fails a correct native dialog. For native dialogs,
assert that focus is never on a page element outside the dialog: inside the dialog or `body` are
both allowed, anything else is a leak. Not measured here.

## Skip link and landmarks (2.4.1)

The first Tab stop is "Skip to main content"; Enter on it, then the next Tab lands inside `main`
(or `main` with `tabindex="-1"` holds focus). Not measured here.

## Composite widgets: one tab stop, arrow keys

Tabs, menus, listboxes, radio groups, grids and trees follow the ARIA Authoring Practices
patterns: Tab enters the widget once (on the selected or last-used item), arrow keys move within
it, Home and End jump, Tab leaves. Assert the walk contains one stop for the widget, then drive
the arrows and assert `aria-selected` or `aria-checked` and focus move together. Not measured here.

## Focus not obscured (2.4.11, new in 2.2)

After every Tab, the focused element's bounding box must not be entirely covered by a sticky
header, footer or cookie banner. Partly covered still passes 2.4.11; full visibility is 2.4.12
(AAA). Compare `element.getBoundingClientRect()` with each fixed or
sticky element's rectangle. Not measured here.

## Focus after removal

Deleting a row, closing a toast or finishing a step must leave focus on something sensible (the
next row, the list heading, the new step's heading), never on `body`. Observed, not asserted: a
closed dialog that does not restore focus left it on `body` in one run and on the hidden Cancel
button in another (the check asserts only that focus is on the opener), so assert where focus must
be, not where it must not be.

## Names, descriptions and announcements

Assert what the browser computes, not attributes:

```ts
await expect(page.getByRole("textbox", { name: "Email" })).toHaveAccessibleDescription("Enter an email address, like name@example.com.");
await expect(page.getByRole("textbox", { name: "Email" })).toHaveAttribute("aria-invalid", "true");
```

With playwright-core alone in Chromium, read the accessibility tree over the DevTools protocol
(measured; it returns the computed `description` and properties such as `invalid` and `live`):

```js
/**
 * One node of Chromium's accessibility tree.
 *
 * @param {import("playwright-core").Page} page - The page.
 * @param {string} selector - CSS selector of the element.
 * @returns {Promise<{ role: string, name: string, description: string, properties: Record<string, unknown> }>} The node.
 */
async function accessibilityNode(page, selector) {
	const cdp = await page.context().newCDPSession(page);

	try {
		const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
		const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector });
		const { nodes } = await cdp.send("Accessibility.getPartialAXTree", { nodeId, fetchRelatives: false });
		const node = nodes[0] ?? {};
		const properties = {};

		for (const property of node.properties ?? []) properties[property.name] = property.value?.value;

		return { role: node.role?.value ?? "", name: node.name?.value ?? "", description: node.description?.value ?? "", properties };
	} finally {
		await cdp.detach();
	}
}
```

- **Form errors (3.3.1, 1.3.1):** submit with Enter from the field; then `properties.invalid` is
  `"true"` and `description` equals the error text. A missing `aria-describedby` passes axe
  (measured).
- **Status messages (4.1.3):** read the region before the update (`properties.live` is `polite`
  or `assertive`), trigger the update, then assert the text is in it. Text written into a plain
  `p` passes axe (measured).
- `locator.ariaSnapshot()` with `toMatchAriaSnapshot` pins the roles and names of one region (a
  dialog, a menu). Keep snapshots scoped and short; a whole-page snapshot breaks on every copy change.

## Reflow at 400% (1.4.10)

```js
/**
 * How far the content is wider than the viewport, in CSS pixels. Runs in the page.
 *
 * @returns {number} Overflow.
 */
function horizontalOverflow() {
	return document.documentElement.scrollWidth - window.innerWidth;
}

const page = await browser.newPage({ viewport: { width: 320, height: 640 } });
```

Overflow must be at most 1 pixel (measured: a fixed `40rem` card fails it; the 336 px overflow
printed is observed, not asserted). 320 CSS
pixels is 1280 at 400% zoom. Content that needs two dimensions (data tables, maps, diagrams) is
exempt; scope the check around it. Repeat for each page state that changes layout (open menu,
dialog).

## Text spacing (1.4.12)

Inject `* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em
!important; } p { margin-bottom: 2em !important; }` with `page.addStyleTag`, then assert no
element with `overflow: hidden` has `scrollHeight > clientHeight` or `scrollWidth > clientWidth`.
Not measured here.

## Reduced motion

```js
/**
 * Number of running animations and transitions. Runs in the page.
 *
 * @returns {number} Count.
 */
function runningAnimations() {
	return document.getAnimations().filter(function running(animation) {
		return animation.playState === "running";
	}).length;
}

const page = await browser.newPage({ reducedMotion: "reduce" });
```

Zero running animations with reduced motion requested (measured: an infinite pulse that ignores
the media query is caught). `getAnimations` sees CSS animations, transitions and the Web
Animations API; motion driven by `requestAnimationFrame` or a canvas needs its own hook.

## Forced colors and contrast preferences

Pages opened with `forcedColors: "active"` or `contrast: "more"` emulate Windows high contrast and
the increased-contrast preference. Review screenshots of key states (`test-visual`): forced
colors drop `box-shadow`, so a focus ring drawn only with a shadow disappears. Not measured here.
