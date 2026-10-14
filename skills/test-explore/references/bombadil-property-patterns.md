# Property patterns

Temporal operators come from `@antithesishq/bombadil`; browser helpers from
`@antithesishq/bombadil/browser`.

```ts
import { always, eventually, next, not, now, type Formula } from "@antithesishq/bombadil";
import { extract } from "@antithesishq/bombadil/browser";
```

- `always(x)`: `x` holds now and in every later state.
- `eventually(x).within(n, "seconds")`: `x` holds now or within the bound.
- `next(x)`: `x` holds in the next state.
- `now(thunk)`: lift a thunk into a formula, to combine with `.and`, `.or`, `.implies`, `.not()`.
- Extractors return a `Cell`; read it with `.current` inside thunks only.

## Invariant

```ts
const notificationCount = extract(function count(state) {
	return state.document.querySelectorAll("[role=status] .notification").length;
});

export const atMostFiveNotifications = always(function bounded() {
	return notificationCount.current <= 5;
});
```

## Settles: may break briefly, must recover

For checks that are false while data refetches (filters, totals after an edit):

```ts
/**
 * A check that may fail briefly but must hold again within five seconds.
 *
 * @param check - The condition over current extractor values.
 * @returns The property.
 */
function settles(check: () => boolean): Formula {
	return always(now(function broken() { return !check(); }).implies(eventually(check).within(5, "seconds")));
}

export const filteredRowsMatchFilter = settles(function matches() {
	const view = statusFilter.current;

	return view === null || view.rowStatuses.every(function allowed(status) { return status === view.chosen; });
});
```

## Bounded guarantee

Something that starts must end: spinners, busy indicators, transient errors.

```ts
export const busyIndicatorsSettle = always(
	now(function busy() { return busyCount.current > 0; }).implies(
		eventually(function idle() { return busyCount.current === 0; }).within(20, "seconds"),
	),
);
```

## Right after an action

`next` checks the state after the action Bombadil takes next. Combine it with what the
extractor saw about that action (for example a flag set by a keydown listener in the page kit):

```ts
export const escapeClosesDialogs = always(function afterEscape() {
	const { top, closable } = dialogState.current;

	return !closable || next(function closed() { return !dialogState.current.escaped || dialogState.current.top !== top; });
});
```

## Capture a value, compare later

Evaluate a cell in the outer thunk and close over it in the inner one:

```ts
export const submittedNameIsConfirmed = always(function submitted() {
	const entered = nameField.current?.trim() ?? "";

	return now(function hasName() { return entered !== ""; })
		.and(next(function submitting() { return submitInProgress.current; }))
		.implies(eventually(function confirmed() { return notice.current?.includes(entered) ?? false; }).within(5, "seconds"));
});
```

## State machine

Allowed transitions only; include "unchanged" so reloads and no-op actions do not fail it.

```ts
/**
 * The counter moves to `current + delta` in the next state.
 *
 * @param delta - Expected change.
 * @returns The transition formula.
 */
function moves(delta: number): Formula {
	return now(function capture() {
		const current = counter.current;

		return next(function moved() { return counter.current === current + delta; });
	});
}

export const counterStepsByOne = always(moves(0).or(moves(1)).or(moves(-1)));
```

## Arithmetic from the screen

Parse displayed amounts to integer minor units and compare: lines sum to the subtotal, debits
equal credits, a report's columns add up. Return `null` from the extractor while any figure is
missing or loading.

```ts
/**
 * Integer minor units from displayed money text, or null when there are no digits.
 *
 * @param text - Displayed amount, any locale.
 * @returns Signed minor units, or null.
 */
function minorUnits(text: string | null | undefined): number | null {
	const digits = (text ?? "").replace(/\D/gu, "");

	if (digits === "") return null;

	return /[-−]/u.test(text ?? "") ? -Number(digits) : Number(digits);
}
```

## Floor growth (leaks)

Peaks are noisy; compare the minimum of the recent window with the minimum of a long window.

```ts
/**
 * A resource metric whose recent floor may not exceed its long-run floor by more than a limit.
 *
 * @param metric - A field of `state.resources`.
 * @param limit - Allowed growth in the metric's unit.
 * @param minutes - Length of the long window.
 * @returns The property.
 */
function boundedGrowth(metric: "dom_nodes" | "js_event_listeners" | "js_heap_used", limit: number, minutes: number): Formula {
	const samples: Array<{ at: number; value: number }> = [];
	const growth = extract(function measure(state) {
		const at = state.resources.timestamp * 1000;

		samples.push({ at, value: state.resources[metric] });

		while (samples.length > 2 && (samples[0]?.at ?? at) <= at - minutes * 60_000) samples.shift();

		const recent = samples.filter(function isRecent(sample) { return sample.at > at - 3 * 60_000; }).map(function valueOf(sample) { return sample.value; });

		return Math.min(...recent) - Math.min(...samples.map(function valueOf(sample) { return sample.value; }));
	});

	return always(function withinLimit() { return growth.current <= limit; });
}

export const domNodesReleased = boundedGrowth("dom_nodes", 5_000, 15);
```

The built-in `noResourceLeak` from `@antithesishq/bombadil/browser/extras/resources` is a
sliding-window alternative; prefer DOM nodes or listeners over heap, which garbage collection
makes noisy.

## Reach lists

Export a no-op generator whose argument names the extractors this spec exists to cover. The
runner reads the names from source and reports which ones never had data, so coverage counts
only what the spec is for. Use it in the top-level spec as
`export const reaches = reaching(["cartTotals", "dialogState"]);`.

```ts
import type { ActionGenerator } from "@antithesishq/bombadil";
import { actions, type ActionTemplate } from "@antithesishq/bombadil/browser";

/**
 * Declares the extractors this spec must reach; offers no actions.
 *
 * @param _names - Extractor names.
 * @returns An empty generator.
 */
export function reaching(_names: readonly string[]): ActionGenerator<ActionTemplate> {
	return actions(function none() { return []; });
}
```
