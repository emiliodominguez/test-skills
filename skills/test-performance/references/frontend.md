# Frontend performance budgets

Lab measurements are reproducible enough to catch a regression on a change. Field measurements
from real users decide whether users are affected. Use lab checks to gate and field data to set
priorities. None of these tools was run in this repository; the content follows their
documentation.

## Core Web Vitals: lab versus field

| Metric | Good, field p75 | In the lab | Lab proxy |
| --- | --- | --- | --- |
| Largest Contentful Paint (LCP) | 2.5 s or less | Yes | LCP |
| Interaction to Next Paint (INP) | 200 ms or less | No (needs real interactions) | Total Blocking Time (TBT), scripted-interaction timing |
| Cumulative Layout Shift (CLS) | 0.1 or less | Load-time shifts only | CLS during load and scripted flows |

Field data (Chrome UX Report, a RUM library reporting `web-vitals`) is judged at the 75th
percentile per page type and device class. INP replaced First Input Delay as a Core Web Vital in
2024.

## Lighthouse CI

```json
{
	"ci": {
		"collect": {
			"url": ["http://localhost:4173/", "http://localhost:4173/products/1"],
			"startServerCommand": "npm run preview",
			"numberOfRuns": 5,
			"settings": { "preset": "desktop" }
		},
		"assert": {
			"aggregationMethod": "median-run",
			"assertions": {
				"largest-contentful-paint": ["error", { "maxNumericValue": 2500 }],
				"cumulative-layout-shift": ["error", { "maxNumericValue": 0.1 }],
				"total-blocking-time": ["error", { "maxNumericValue": 200 }],
				"resource-summary:script:size": ["error", { "maxNumericValue": 250000 }],
				"categories:performance": ["warn", { "minScore": 0.9 }]
			}
		},
		"upload": { "target": "filesystem", "outputDir": "out/lhci" }
	}
}
```

- Run `lhci autorun` against a production build served locally or a preview deployment, never a
  dev server.
- At least 3, preferably 5 runs per URL, asserted on the median run; a single run varies by
  hundreds of milliseconds on shared runners.
- Fix the device profile, network and CPU throttling in the config so runs compare. Mobile
  emulation applies CPU throttling relative to the runner's speed, so a faster runner shifts
  scores; keep the runner type fixed and record it.
- Start budgets at the measured median plus margin (about 10-20% for timings) and ratchet;
  assert on metrics, keep the category score as a warning.

## Bundle budgets

- Budget compressed bytes (gzip or brotli, as served) per entry point and per lazy chunk, not
  the total of all files.
- Tools: size-limit (`limit` per path, can also estimate execution time), bundler limits
  (webpack `performance.maxEntrypointSize` with `hints: "error"`), bundlewatch-style CI comments.
- The check is deterministic: gate on every change. Print the diff with the module that grew
  (a bundle analyzer report as an artifact) so the fix is obvious.

## Long tasks during flows

Collect long tasks (over 50 ms) while an end-to-end test runs a flow, and assert a budget on
their count and total blocking time for that flow:

```js
// Injected before the page scripts run, for example with the browser driver's init-script hook.
window.__longTasks = [];
new PerformanceObserver(function record(list) {
	for (const entry of list.getEntries()) window.__longTasks.push({ start: entry.startTime, duration: entry.duration });
}).observe({ type: "longtask", buffered: true });
```

The `longtask` entry type and the newer `long-animation-frame` entries are Chromium features;
run this check in Chromium only, with CPU throttling fixed.

## Memory leaks

A leak shows as retained memory that grows with each repetition of a cycle that should return
to the same state (open and close a dialog, navigate away and back, mount and unmount a view).

1. Run the cycle 2-3 times to warm caches and lazy modules.
2. Force garbage collection and record the baseline: in Chromium through the DevTools protocol
   (`HeapProfiler.collectGarbage`, then `Runtime.getHeapUsage` for `usedSize`); in Node with
   `--expose-gc`, `gc()` and `process.memoryUsage().heapUsed`.
3. Run the cycle N times (10-20), collecting garbage and recording after each, or at a few
   checkpoints.
4. Assert on the slope: retained bytes per cycle under a small budget measured on the fixed code
   (allocator noise is tens of kilobytes; a leaked view tree is usually far more). A single
   before and after pair confuses a cache filling once with a leak.
5. On failure, take heap snapshots after the warm-up and after the last cycle and diff them:
   detached DOM nodes, listeners, closures held by a module-level array or a subscription. Tools
   such as memlab automate the cycle and report retainer traces.

Run leak checks nightly or per change on the few flows that keep long-lived state; each takes
seconds to minutes.
