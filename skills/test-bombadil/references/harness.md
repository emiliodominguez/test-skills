# Bombadil harness: the page kit and the fences

Bombadil records state about one animation frame after each action, replays clicks only on
elements it can identify, and answers dialogs itself. The page kit, injected as an init script
before the app loads, makes the page deterministic and observable. It never ships.

## Stable test ids

Replay matches a click only by a test id, an id, a role with an accessible name, or an ARIA
label; it ignores text. Without ids, recorded clicks do not replay.

Patch `Element.prototype.getAttribute` so that reading the test-id attribute on an element that
has none returns a synthesized key: tag, role, a stable label, and an index among elements with
the same key. Rows are keyed by table and position.

```js
/**
 * A short, stable label from the first non-empty candidate: whitespace collapsed, digits folded
 * to "#", at most 60 characters, lone surrogates removed.
 *
 * @param {Array<string | null | undefined>} parts - Candidates in priority order.
 * @returns {string} The label.
 */
function stableLabel(parts) {
	const chosen = parts.find(function isText(part) { return typeof part === "string" && part.trim() !== ""; }) ?? "";

	return chosen.replaceAll(/\s+/gu, " ").trim().replaceAll(/\d+/gu, "#").slice(0, 60).replaceAll(/[\uD800-\uDFFF]/gu, "");
}

const getAttribute = Element.prototype.getAttribute;

// keyOf(element) joins tag, role, stableLabel([aria-label, labelled-by text, title, text, alt])
// and the index among connected elements with the same key.

Element.prototype.getAttribute = function readAttribute(name) {
	const value = getAttribute.call(this, name);

	return value === null && name === "data-test" && this.isConnected ? keyOf(this) : value;
};
```

Folding digits keeps keys stable when counts and totals change. Traces recorded before the kit
existed will not replay.

## Settling

Wrap `requestAnimationFrame` and hold frames requested by non-app code until the page is quiet:
no request or IPC call in flight, no DOM mutation for about 60 ms, and short app timers (debounces
up to about 400 ms) have fired. Cap the hold at about 3 seconds, longer while code chunks load.
Without it, a run and its replay end in different states. Expect each step to take about twice
as long.

An "impatient" option skips settling on a seeded share of steps, so properties also see
half-rendered states. Findings from impatient runs must be confirmed by replay.

## Measurements for properties

Expose on a window global (for example `window.__bombadil`) what properties read:

- Requests or IPC calls with duration, outcome and whether fault injection touched them.
- Event Timing interactions of 104 ms or more, and long tasks.
- Per-step cost: settle time, calls, the busiest endpoint, mutation batches, typed characters.
- For a desktop shell, main-process health: event-loop lag and memory, sampled every second by a
  hook loaded into the main process.
- An accessibility scan result: inject axe-core and run WCAG A/AA rules after about 800 ms of
  quiet, at most every 3 seconds. Ignore interaction latency that overlaps a scan.

## Injection sentinels

Bombadil answers dialogs itself, so an injected `alert(1)` would pass unseen. Record calls to
`alert`, `confirm`, `prompt`, `window.open`, `eval` and `Function`; scripts, iframes and objects
inserted after load; inline `on...` handlers; `javascript:` URLs; any element with a marker id
used in your injection payloads (for example `bmbxss`); and every `securitypolicyviolation`
event. A property asserts the lists stay empty.

## Fences

Before exploring, stub what a random click must not do: native open, save and message dialogs;
printing; opening external links; relaunch and quit. For exploration, file dialogs can answer from
the run's seed with hostile choices: `../` paths, symlinks out of the folder, empty files, 16 MB
files, non-UTF-8 content, accented names, existing files to overwrite. Wrap file writes in the
main process and report any write outside the chosen folder.

## Seeded fault injection

Wrap the request or IPC layer to apply rules by address glob, first match wins, with a seeded
generator (for example mulberry32):

- `delay`: a random latency range.
- `fail`: refuse before the call runs, as if never sent.
- `lose`: run the call, lose the answer, to test idempotent retries.
- `drop`: never answer until the client times out.

Profiles such as `slow`, `flaky`, `lossy` and `offline`, with authentication excluded so the run
does not lock itself out. Mark touched calls so network properties ignore them. A replay repeats
the same decisions only while calls arrive in the same order, so fault findings may not replay
exactly.

## Viewport presets

Fix size per run (resize does not replay): desktop, small, large, high-DPI, zoom 125% and 150%,
light, dark, reduced motion, forced colors, combinable. Set the real window size too, since the
emulated size can lapse around navigation, and reset zoom each run because the browser remembers it.
