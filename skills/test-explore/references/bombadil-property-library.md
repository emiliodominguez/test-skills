# Generic property library

Properties that apply to most web apps with little or no change. Start every spec with the
Bombadil defaults, then add these as the app earns them.

```ts
export * from "@antithesishq/bombadil/browser/defaults/properties";
```

The defaults: `noHttpErrorCodes`, `noUncaughtExceptions`, `noUnhandledPromiseRejections`,
`noConsoleErrors`.

## Text sanity

Walk visible text nodes (`createTreeWalker` with `SHOW_TEXT`, skip nodes whose parent fails
`checkVisibility()`) and collect suspects:

| Property | Suspect |
| --- | --- |
| `noRawMessageKeys` | Text shaped like `area.key.name` that is a real catalog key |
| `noUnfilledPlaceholders` | `{name}` where `name` is a real placeholder in the catalogs |
| `noBrokenValues` | `NaN`, `undefined`, `Infinity`, `[object Object]`, `Invalid Date` |
| `noFiguresBesideErrors` | Totals still shown next to an error that invalidated them |

Flatten the translation catalogs at bundle time into key sets so the checks do not guess.

## Layout and accessibility

| Property | Check |
| --- | --- |
| `noHorizontalOverflow` | `documentElement.scrollWidth - innerWidth <= 1` |
| `controlsHaveNames` | Every button, link and field has an accessible name (aria-label, labelledby, title, label, text, image alt) |
| `dialogsHaveNames` | Every dialog has a name |
| `focusStaysInModal` | With a modal open (`dialog:modal`, `:popover-open`), focus is inside it |
| `noDuplicateIds` | Ids are unique |
| `referencesResolve` | `aria-labelledby`, `aria-describedby`, `aria-controls` (unless collapsed) and `label[for]` point at existing ids |
| `dialogsFitTheWindow` | Dialog rectangles are inside the viewport |
| `imagesLoad` | No `img` with `complete && naturalWidth === 0` |
| `labelsNotCutOff` | No label with `scrollWidth > clientWidth + 1`, overflow hidden and no ellipsis |
| `noSeriousAccessibilityIssues` | The page kit's axe result has no serious or critical violations (policy `record`) |
| `accessibilityChecksRun` | The axe scan itself did not throw |

## Responsiveness and resources

| Property | Check | Policy |
| --- | --- | --- |
| `interactionsStayResponsive` | No Event Timing interaction above a measured threshold, ignoring those overlapping a scan | record |
| `noLongFreezes` | No long task over a threshold | record |
| `busyIndicatorsSettle` | Busy indicators clear within a bound | stop |
| `domNodesReleased`, `listenersReleased`, `heapReleased` | Floor growth within limits over 15 minutes | record |

## Network

Read the page kit's call log for the last couple of seconds and ignore calls fault injection touched.

| Property | Check |
| --- | --- |
| `requestsDoNotFailUnexpectedly` | No internal error, unknown endpoint or unavailable bridge |
| `requestsGetValidInput` | The server never answers "invalid input": the UI validates first |
| `requestsAnswerInTime` | Per-call duration under a bound |
| `noRequestStorms` | Calls per second under a bound |
| `callsPerActionBounded` | Total calls, and calls to one endpoint, per action under bounds (N+1) |
| `keystrokesStayCheap` | Fast typing of 6+ characters costs at most about one call per two characters (missing debounce) |

Set bounds at about twice the maximum observed in clean runs and record that measurement with
the machine and load it came from.

## Injection

| Property | Check |
| --- | --- |
| `injectedTextStaysInert` | The page kit's sentinels saw no dialog call, `eval`, inserted script, inline handler, `javascript:` URL or marker-id element |
| `noCspViolations` | No `securitypolicyviolation` events |

Pair these with markup payloads in the value sets (see action patterns) that carry the marker id.

## Domain properties worth writing for any app

- Displayed totals add up from displayed lines.
- Filtered rows match the active filter or badge (settles pattern).
- The navigation a role sees equals what the permission function grants, against an
  independently written table.
- A refusal message names a value that the app's own parser actually refuses.
- Forms with a required field or blocking notice cannot submit until satisfied.
