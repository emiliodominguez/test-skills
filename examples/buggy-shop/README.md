# Buggy Shop

A four-product store with seeded bugs, explored by three drivers without a single scripted path:
Bombadil, fast-check with Playwright, and Hypothesis with Playwright. `--fixed` serves the same
app with every bug turned off, so each harness can be shown to stay silent on a correct build.

```sh
pnpm install
pnpm demo            # Bombadil, with bugs: exits 2 and prints the findings
pnpm demo:fixed      # Bombadil, bugs off: exits 0, no findings
pnpm demo:fc         # fast-check + Playwright, with bugs: exits 2 with shrunk reproductions
pnpm demo:fc:fixed   # fast-check + Playwright, bugs off: exits 0
python -m pytest examples/buggy-shop/hypothesis -q                      # Hypothesis, with bugs: fails
BUGGY_SHOP_FIXED=1 python -m pytest examples/buggy-shop/hypothesis -q   # Hypothesis, bugs off: passes
```

Needs Chrome or Chromium; set `CHROME=/path/to/chrome` if it is not found.

## The bugs

| Bug             | What happens                                                                                     | Caught by                                     |
| --------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| `qty-nan`       | Clearing a quantity shows `$NaN` in the line and the total                                       | `noBrokenValues` (kit)                        |
| `stale-total`   | Removing a line leaves the old total on screen                                                   | `cartTotalAddsUp`, `emptyCartIsFree` (domain) |
| `coupon-crash`  | Any invalid coupon throws `Cannot read properties of null`                                       | `noUncaughtExceptions` (Bombadil default)     |
| `note-xss`      | The gift note is rendered as HTML                                                                | `injectedTextStaysInert` (kit + page kit)     |
| `escape-dialog` | Escape cannot dismiss the confirmation dialog                                                    | `escapeClosesDialogs` (kit)                   |
| `stuck-spinner` | With three or more items, placing the order spins forever and the dialog's buttons stay disabled | `busyIndicatorsSettle` (kit)                  |
| `qty-overflow`  | Not planted. A huge quantity overflows safe integers, so the total stops matching its lines      | `cartTotalAddsUp` (domain)                    |

The last row is a bug Bombadil found in the first "fixed" build. Nobody wrote a test for it
because nobody thought of it; the property did not need anyone to.

## Files

- `public/` - the app, plain HTML and JavaScript. Each bug sits behind `seeded("name")`.
- `serve.mjs` - static server; `--fixed` turns the bugs off, `--kit` injects the page kit.
- `bombadil/spec.ts` - the generic kit from `skills/test-explore/assets/bombadil-kit`, two domain
  properties and a weighted action mix.
- `fast-check/explore.mjs` - the fast-check kit from `skills/test-explore/assets/fast-check-explore.mjs`
  with the cart extractor and the `cartTotalAddsUp` property.
- `hypothesis/test_explore.py` - a `RuleBasedStateMachine` with the same actions and properties
  (needs `hypothesis`, `playwright` and `pytest`).

## Measured

| Driver                        | Budget      | Seeded bugs found                                                                      | Fixed build |
| ----------------------------- | ----------- | -------------------------------------------------------------------------------------- | ----------- |
| Bombadil 0.7.8                | 2 minutes   | 5 or 6 of 6 per run                                                                    | Silent      |
| fast-check 4.10 + Playwright  | 4 minutes   | 6 of 6 in 6 of 7 measured runs, 5 in the other; each shrunk to 1-5 actions             | Silent      |
| Hypothesis 6.169 + Playwright | 60 examples | 6 of 6 in the latest run; 5 of 6 (not the five-step stuck spinner) in two earlier ones | Passes      |
