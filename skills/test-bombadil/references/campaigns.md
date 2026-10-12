# Campaigns and CI

## Campaigns

A campaign is a matrix of runs with a budget, defined as data:

```json
{
	"budget": "12h",
	"round": "15m",
	"adaptive": true,
	"cellBudget": 60,
	"confirm": true,
	"shrink": "20m",
	"weights": { "specification": { "checkout": 2 }, "faults": { "none": 2 } },
	"matrix": {
		"specification": ["*"],
		"locale": ["en", "es"],
		"preset": ["desktop", "small", "dark,zoom-125"],
		"faults": ["none", "flaky"],
		"axe": [false, true]
	}
}
```

Useful campaigns:

| Campaign | Budget | Runs |
| --- | --- | --- |
| smoke | 30-40 min, 5-min rounds | Every spec, default locale |
| night | 8h, 20-min rounds | Every spec, every locale, desktop and small |
| accessibility | 2h | Every spec with the axe scan across desktop, small, zoom, dark, forced colors with reduced motion |
| faults | 2h | Every spec under slow, flaky and lossy profiles, findings confirmed |
| performance | 2h | The busiest specs on normal and large data, coverage instrumentation off |

### Scheduling

Run every cell once first. Then pick the next cell by score:

```text
score = weight * (adaptive ? 1 + 2 * coverageDeficit : 1) * 1.5^min(fresh, 2) * 0.7^min(repeated, 3) / (1 + runs)
```

- `coverageDeficit`: the share of the spec's extractors that had data in fewer than 25 states.
- `fresh`: new findings the cell produced; `repeated`: findings it keeps reproducing.

Rewrite a `summary.md` after every round so an interrupted campaign still reports. Delete the
output of clean rounds. With `confirm`, replay each finding on a fresh app; with `shrink`,
minimize the steps (see `test-findings`).

On a laptop, prevent sleep for the duration (for example `caffeinate -i` on macOS).

## CI

- **Per change:** optional. A short smoke spec, 2-5 minutes, headless, exit on violation. Make
  developers responsible for running the covering spec when they add or change a property or
  action, not for running everything.
- **Scheduled:** nightly or weekly campaigns on the main branch or a staging deployment. Upload
  the output folder (traces, screenshots, `run.json`, summary) as an artifact so a finding can be
  inspected and reproduced locally.
- The official GitHub Action (`antithesishq/bombadil-action`) covers a managed browser against a
  URL: inputs `driver`, `origin`, `specification`, `time-limit`, `exit-on-violation`,
  `output-path`. For an Electron app or a custom harness, run your runner script instead.
- Linux containers often need `--no-sandbox` for the managed browser.
- Fail the job on exit `2` (violation) and on `1` (harness error), and say which in the summary.

## Before adding a property to a campaign

Run its spec for a few minutes with keep-going on a correct app. It must stay silent and must
appear as reached in the coverage report. A property that never reached its screen checked
nothing.
