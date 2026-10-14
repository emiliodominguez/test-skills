# Playwright screenshot assertions

Checked against `@playwright/test` 1.64.0 (types, comparator source and the runs in
`examples/visual/`). Revisit on upgrade: defaults and the path template have changed before.

## Config

```js
// playwright.config.mjs
import { defineConfig } from "@playwright/test";

export default defineConfig({
	// One template for every project; no {platform}, because every run happens in one container.
	// A __snapshots__ folder (or the default -snapshots folders) is what the test guard recognizes.
	snapshotPathTemplate: "{testDir}/__snapshots__/{testFilePath}/{arg}{-projectName}{ext}",
	expect: {
		toHaveScreenshot: { threshold: 0.2, animations: "disabled", caret: "hide", stylePath: "./tests/screenshot.css" },
	},
	use: {
		viewport: { width: 1280, height: 720 },
		deviceScaleFactor: 1,
		colorScheme: "light",
		reducedMotion: "reduce",
		locale: "en-US",
		timezoneId: "UTC",
	},
});
```

The default template is
`{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}{-projectName}{-snapshotSuffix}{ext}`,
where the suffix is the platform: baselines are per OS (`card-chromium-linux.png`) because
rendering differs per OS. Keep `{platform}` only when you deliberately maintain and review one
baseline set per OS; otherwise render everywhere in the same container and drop it.

The test guard's `updated-snapshots` rule matches `__snapshots__/` and `__screenshots__/`
folders, image files under `-snapshots/` folders, Loki's `.loki/reference/` and BackstopJS's
`bitmaps_reference/`. Baselines in any other custom folder pass the guard unseen: keep them under
a matched path or review them by hand.

## `toHaveScreenshot` options

| Option | Default | Use |
| --- | --- | --- |
| `threshold` | `0.2` | Per-pixel color distance (YIQ, 0 to 1) below which a pixel counts as equal |
| `maxDiffPixels` | unset (0 allowed) | Absolute allowance of differing pixels |
| `maxDiffPixelRatio` | unset | Allowance as a fraction of the image area; grows with the screenshot |
| `animations` | `"disabled"` | Finite animations jump to their end, infinite ones to their start |
| `caret` | `"hide"` | Hides the text caret |
| `mask`, `maskColor` | none, pink | Paints over locators: dynamic regions that are asserted elsewhere |
| `stylePath` | none | CSS applied only while capturing; pierces shadow DOM and frames |
| `scale` | `"css"` | One image pixel per CSS pixel, independent of `deviceScaleFactor` |
| `fullPage`, `clip`, `omitBackground` | off | Page screenshots only |
| `timeout` | expect timeout | How long to wait for a stable screenshot |

Behaviors that change decisions:

- **Stability first.** The assertion captures until two consecutive screenshots match, then
  compares with the baseline. Content that never settles (an animation left running) fails with
  a timeout even while recording a baseline; measured in `examples/visual/`.
- **Both allowances set: the stricter wins.** With `maxDiffPixels` and `maxDiffPixelRatio` both
  set, the comparator uses the smaller pixel count. A project-wide `maxDiffPixels: 0` silently
  overrides a per-test ratio; observed while building the example and confirmed in the 1.64
  comparator.
- **Update modes** (`--update-snapshots`, `-u`): `default` (no flag) writes missing baselines but
  fails those tests so CI never passes silently; `missing` writes them and passes; `changed`
  rewrites only mismatching ones and is the preset for a bare `-u`; `all` rewrites everything that
  ran; `none` writes nothing. Combine `changed` with `--grep` or a file path so one update touches
  only the screenshots you reviewed.
- **Failure artifacts.** A mismatch attaches the expected, actual and diff images to the test
  result (actual and diff land under `outputDir`); the HTML report shows them side by side. Upload
  the report from CI so the reviewer sees images, not a log line.

## Masking and freezing

```js
test("invoice summary", async function invoiceSummary({ page }) {
	await page.clock.setFixedTime(new Date("2026-01-15T09:30:00Z"));
	await page.route("**/avatars/**", async function fixtureAvatar(route) {
		await route.fulfill({ path: "tests/fixtures/avatar.png" });
	});
	await page.goto("/invoices/fixture-42");
	await expect(page.getByRole("region", { name: "Summary" })).toHaveScreenshot("invoice-summary.png", {
		mask: [page.getByTestId("live-chat-badge")],
	});
});
```

- `page.clock.setFixedTime` fixes `Date` while timers keep running; `page.clock.install` also
  fakes timers so the test can advance them. Either must run before `goto`.
- Seed randomness with `page.addInitScript` replacing `Math.random`, or mask the region.
- Prefer `stylePath` to `mask` for many selectors or third-party widgets: `visibility: hidden`
  keeps layout, `display: none` changes it and can hide a real overlap.

```css
/* tests/screenshot.css: applied only while capturing */
[data-testid="clock"],
.third-party-chat {
	visibility: hidden;
}
html {
	scrollbar-width: none;
}
```

## One rendering environment

Run screenshot tests in the official image pinned to the installed version, locally and in CI:

```sh
docker run --rm --ipc=host -v "$PWD":/work -w /work mcr.microsoft.com/playwright:v1.64.0-noble \
  npx playwright test --project=visual
```

The image tag must match `@playwright/test` exactly (tags `v1.64.0-noble` and `v1.64.0-jammy` exist
in the registry). The browser build matters as much as the OS: this repository's examples ran a
Chromium 141 binary under Playwright 1.64, whose bundled Chromium is 156; baselines recorded with
one build are not portable to the other. Record and compare with the same binary.

A separate project keeps visual tests out of the functional suite's matrix:

```js
projects: [
	{ name: "e2e", testIgnore: /visual/ },
	{ name: "visual", testMatch: /visual\/.*\.spec\./, use: { browserName: "chromium" } },
],
```
