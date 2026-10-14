# Action patterns

```ts
import type { ActionGenerator } from "@antithesishq/bombadil";
import { actions, getFingerprint, weighted, type ActionTemplate } from "@antithesishq/bombadil/browser";
import { clicks, inputs, scroll, back } from "@antithesishq/bombadil/browser/defaults/actions";
```

Action templates: `{ Click: { fingerprint, point } }`, `{ DoubleClick: { fingerprint, point } }`,
`{ TypeText: { text, delayMillis: [min, max] } }` where `text` is `{ Regexp: "..." }`,
`{ PressKey: { code } }` (a key code), `{ ScrollDown: { origin, distance } }`, `{ ScrollUp: ... }`,
`{ SetFileInputFiles: { selector, files } }`, `"Back"`, `"Forward"`, `"Reload"`, `"Wait"`.
Numeric fields accept `[min, max]` ranges that Bombadil samples. `weighted` takes templates or
generators: `weighted([[10, generator], [1, "Wait"]])`.

## Click targets

Offer a click only when the element is visible, inside the viewport and not covered:

```ts
/**
 * A click template for an element, or null when a user could not click it now.
 *
 * @param element - Candidate element.
 * @param view - The page window.
 * @returns The template, or null.
 */
function clickTarget(element: Element, view: Window): { fingerprint: ReturnType<typeof getFingerprint>; point: { x: number; y: number } } | null {
	const rect = element.getBoundingClientRect();

	if (rect.width === 0 || rect.height === 0 || rect.bottom < 0 || rect.top > view.innerHeight) return null;

	const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
	const hit = view.document.elementFromPoint(point.x, point.y);

	return hit && (hit === element || element.contains(hit)) ? { fingerprint: getFingerprint(element), point } : null;
}
```

Compute candidates in an extractor; the generator reads the cell.

## Gating

```ts
/**
 * Offers the wrapped generator's actions only while the app is in use (signed in, unlocked).
 *
 * @param generator - The generator to gate.
 * @returns The gated generator.
 */
export function whileInUse(generator: ActionGenerator<ActionTemplate>): ActionGenerator<ActionTemplate> {
	return actions(function gated() {
		return inUse.current ? generator.generate() : [];
	});
}

export const waiting = actions(function idle(): ActionTemplate[] {
	return ["Wait"];
});
```

Sign in through a dedicated generator that types exact credentials of demo accounts as escaped
literals, and keep every other typing generator away from credential fields. Random input on a
sign-in screen locks accounts after a few tries.

## Typing that replays

Typed text must come from Bombadil's string generators (`{ Regexp: "..." }`, `{ Text: [min, max] }`,
`{ CharSet: ... }`), so the replay can regenerate it. Text computed from runtime randomness or
from changing page state does not replay. Use `Regexp` for anything with meaning.

- Replace the default random typing, which is long and slow, with short fast bursts:
  `{ TypeText: { text: { Text: [1, 24] }, delayMillis: [0, 5] } }`.
- Escape literals before putting them in a pattern. The pattern dialect is Rust's regex syntax.
- Keep very long inputs (thousands of characters) rare and below the size that freezes the
  page, or freeze properties will blame the test.

### Value sets

Named regex alternations, composed with `{macro}` expansion and validated by unit tests:

```ts
export const values = {
	"date.edge": "(29/02/2024|29/02/2025|29/02/2100|31/04/2026|30/02/2026|00/01/2026|2026-10-08|[0-9]{8}|[0-9]{2}/[0-9]{2})",
	"number.edge": "(0|-0|0[.,]00|-1|-0[.,]01|0[.,]001|1e9|1E-3|9007199254740993|99999999999999999999|1\\.234\\.567,89|1,234,567\\.89|00001|[.,]5|5[.,]| 42 |4 2|\\+7|--3)",
	"text.unicode": "(ÁÉÍÓÚ ñ|العربية|日本語|\u{1F600}\u{1F44D}\u{1F3FD}|e\\x{0301}|a\\x{200B}b|\\x{202E}txet|\\x{00A0}nbsp\\x{00A0})",
	"text.markup": "(<b>bold</b>|%s %d|' OR 1=1 --|\\{\\{7\\*7\\}\\}|<img src=x id=bmbxss onerror=alert\\(1\\)>|\"><svg id=bmbxss onload=alert\\(1\\)>|<a id=bmbxss href=javascript:alert\\(1\\)>x</a>)",
};
```

The marker id (`bmbxss`) lets the injection sentinels recognize a payload that rendered.

### Realistic input

Infer a field's purpose from its markup, in order: a data attribute you control, `pattern`, the
label's message key, `autocomplete`, `type`, `inputmode`. Then type three valid values in four
and one near miss. Fields with `maxlength` get text at and beyond the limit.

Near misses are one keystroke from valid: an off-by-one check digit, transposed digits, a wrong
separator. Generate them at bundle time and filter both sets through the app's real validator,
so no valid value is ever offered as a mistake and vice versa.

## Keyboard, double clicks, scrolling, selects, files

```ts
export const keyboard = weighted([
	[10, { PressKey: { code: 9 } }],
	[4, { PressKey: { code: 13 } }],
	[3, { PressKey: { code: 32 } }],
	[2, { PressKey: { code: 27 } }],
	[3, { PressKey: { code: 40 } }],
]);
```

- **Double clicks** on submit buttons, dialog footers and rows: a double submit must not happen.
- **Inner scrolling** on scrollable containers, not only the window.
- **Custom selects:** random clicks rarely open a listbox and then pick an option. Add an
  "open select" generator and a heavily weighted "choose an option" generator active while one
  is open.
- **Files:** `{ SetFileInputFiles: { selector: 'input[type="file"][accept=".csv"]', files: [path] } }`
  with hostile fixtures: empty and corrupt images, empty and broken CSV, BOM plus semicolons,
  Latin-1, CRLF, 10k rows, formula injection (`=HYPERLINK(...)`, `@SUM(...)`, `=cmd|`).

## Workflows as state machines

For flows random clicks cannot finish (checkout, return, close the day), offer the next step
chosen from what the screen shows (buttons and fields found by role or message key), so every
run replays. Give an in-progress workflow momentum (its steps weigh several times more), and
drop a step that changed nothing or was refused last time, or the run presses a refused button
hundreds of times.

## Novelty

Reweight clicks by how often they were already chosen from the same place (route, top dialog,
tab, row count): never-chosen clicks get several times the weight. After a few steps with no DOM
change in the same place (a dead state), boost escape generators (links, Escape, back). Change
only weights, never which actions are offered, so every run still replays.

## Composing a spec

```ts
export * from "./lib/properties.ts";

export const reaches = reaching(["cartTotals", "checkoutDialog"]);

export const shopping = weighted([
	[120, whileInUse(checkoutSteps)],
	[60, whileInUse(clicks)],
	[50, signIn],
	[20, whileInUse(realisticInputs)],
	[15, whileInUse(doubleClicks)],
	[10, whileInUse(keyboard)],
	[10, whileInUse(shortTyping)],
	[1, waiting],
]);
```
