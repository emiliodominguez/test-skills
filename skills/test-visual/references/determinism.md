# Sources of screenshot nondeterminism

Fix each at the source before touching a threshold. A diff that changes between two runs of the
same build is a determinism bug, and its diff image usually names the region.

## Environment

| Source | Symptom in the diff | Fix |
| --- | --- | --- |
| Operating system | Text edges, glyph widths and line wraps differ between a laptop and CI | Record and compare in one pinned container image; no laptop baselines |
| Browser build | Small shifts after a browser or runner upgrade | Pin the runner and browser together; re-record in a dedicated, reviewed change |
| Font fallback | Different typeface or wrapped lines | Ship the fonts the app uses (bundled or installed in the image); emoji and CJK fonts too |
| Web fonts not loaded | Fallback font in some runs | Wait for `document.fonts.ready`; self-host fonts instead of a CDN |
| GPU and compositing | Gradients, shadows, blurred edges differ | Headless with software rendering in the container; same flags everywhere |
| Viewport and pixel ratio | Image size mismatch, scaled text | Fixed viewport, `deviceScaleFactor: 1`, `scale: "css"` |
| Scrollbars | A 15px band appears or vanishes | Hide them with capture-only CSS, or use overlay scrollbars everywhere |
| Color scheme, reduced motion, contrast | Theme flips with the host setting | Set them explicitly in the context; a theme is a matrix axis, not an accident |
| Locale and time zone | Dates, numbers and currency render differently | Fix both in the context; test other locales on purpose |

## Page state

| Source | Symptom | Fix |
| --- | --- | --- |
| Animations and transitions | Timeout waiting for stability, or mid-transition frames | Disable animations at capture; `prefers-reduced-motion` honored by the app |
| Text caret | A one-pixel bar blinks in focused inputs | Hide the caret at capture |
| Clock | "Updated 3 minutes ago", today's date, countdowns | Fixed clock before navigation |
| Random content | Rotating banners, shuffled lists, generated ids or colors | Seed the generator through a test hook, or mask the region |
| Live data | Counts, prices, feeds | Fixture data through a stub at the network boundary |
| Remote images and avatars | Missing or late images, different crops | Route to local fixtures; wait for `img.complete` or decode |
| Lazy loading | Below-the-fold images blank in full-page shots | Scroll to trigger loading, or screenshot elements instead of full pages |
| Skeletons and spinners | Loading state captured | Wait for the loaded state the user sees, not for network idle |
| Hover and focus left over | Highlighted row or focus ring from a previous step | Move the mouse away and blur before capture, or capture a fresh page |
| Canvas, video, maps, charts | Frame-dependent pixels | Pause media at a fixed time, disable chart animation, mask third-party maps |
| Third-party widgets | Chat badges, ads, consent banners | Block them by route in tests, or hide them with capture-only CSS |
| Sticky and fixed elements | Repeated headers in full-page shots | Element screenshots, or position them statically with capture-only CSS |

## Masking rules

- Mask only what another test asserts: a masked clock should have a unit test for its formatting.
- Mask the smallest region. Masking a whole panel hides overlaps and clipping inside it.
- Masks keep the region's size; a layout shift caused by the masked content still shows.
- `visibility: hidden` keeps layout; `display: none` removes the box and can hide a real overlap.

## Proving determinism

Run the unchanged build at least five times against its baselines (the runner's repeat option)
and require every run to pass. A screenshot that differs once in five runs is flaky; measure and
fix it with `test-flaky` instead of raising the allowance.
