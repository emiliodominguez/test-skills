# Buggy Shop

A four-product store with seeded bugs, and a Bombadil specification that finds them without a
single scripted path. `--fixed` serves the same app with every bug turned off, so the same
specification can be shown to stay silent on a correct build.

```sh
pnpm install
pnpm demo         # with bugs: exits 2 and prints the findings
pnpm demo:fixed   # bugs off: exits 0, no findings
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
- `bombadil/spec.ts` - the generic kit from `skills/test-bombadil-spec/assets/kit`, two domain
  properties and a weighted action mix.
