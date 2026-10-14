# Visual testing tools

Only the Playwright runner was exercised in this repository. The rest is a map for choosing; check
each tool's current documentation for options and pricing before committing to it.

## Choosing

| Situation | Start with | Why |
| --- | --- | --- |
| A browser test runner is already in the repository | Its built-in screenshot assertion | Baselines next to tests, reviewed in the same change, no service |
| Components live in Storybook | A story-based tool | Every story is already an isolated, named state |
| Several browsers needed on every change, no container to maintain | A hosted service | It renders in its own fixed browsers and gives a review UI |
| URL lists for a marketing or content site, no test suite | BackstopJS | Config-driven scenarios, Docker rendering, HTML report |

## Tools

| Tool | Hosting | Captures | Baselines | Notes |
| --- | --- | --- | --- | --- |
| Playwright `toHaveScreenshot` | Self | Pages and locators in the test | Files in the repository | Run in the version-matched container; see [playwright.md](playwright.md) |
| Chromatic | Hosted | Storybook stories; also Playwright and Cypress tests | In the service, per branch | From the Storybook maintainers; TurboSnap captures only stories affected by changed files; billed per snapshot |
| Lost Pixel | Self (open source) or hosted | Storybook, Ladle, Histoire stories, pages, custom shots | Repository in self-hosted mode | Self-hosted mode compares inside Docker |
| Loki | Self | Storybook stories | Repository | Renders in Docker Chrome; `loki update` re-records, so review the diff |
| Percy | Hosted | DOM snapshots from Playwright, Cypress, Storybook and other SDKs | In the service | Re-renders the uploaded DOM in its own browsers and widths |
| Argos | Hosted, open-source core | Screenshots from Playwright, Cypress, Storybook | In the service | Uploads screenshots the suite already takes |
| BackstopJS | Self | URLs and selectors from a JSON config | Repository | `hideSelectors`, `removeSelectors`, per-scenario `misMatchThreshold` (percent); `--docker` renders in a container |
| Storybook test runner with an image matcher | Self | Stories, through Playwright | Repository | Cheapest path when Storybook exists and a service is not an option |

## Hosted versus self-hosted

- **Hosted** removes the rendering-environment problem and gives reviewers a UI with approve and
  reject per snapshot, tied to the change request as a status check. Costs: per-snapshot billing
  that grows with the matrix, screenshots of unreleased UI leave the network, and the approval
  lives outside the repository, so the guard on snapshot files does not see it. Require that
  approvals are made by someone other than the author of the change.
- **Self-hosted** keeps baselines in the repository, reviewed as image diffs in the change. Costs:
  a container image to pin and upgrade, repository growth (move baselines to large-file storage
  once they pass a few tens of megabytes), and a review UI that is only as good as the code host's
  image diff view plus the uploaded report.

## Stories as the unit

- One story per visual state: default, hover and focus (forced with pseudo-state tooling or a play
  function), disabled, error, loading, empty, overflowing text, right-to-left.
- Stories render fixture data only; a story that fetches is a flaky snapshot.
- Decorators set theme, locale and viewport per story, which keeps the matrix explicit and
  selectable instead of multiplying every story.
- Disable or skip snapshots for stories that exist for documentation only.
