---
name: test-accessibility
description: "Accessibility tests: axe in every state, keyboard and focus checks, names, contrast, screen reader smoke. Use when a11y, WCAG, keyboard or screen reader bugs come up. Hands off to `test-component` or `test-findings`."
compatibility: "Verified in this repository's example with axe-core 4.14 injected into Chromium through playwright-core 1.64, and axe-core 4.14 under jsdom 30. @axe-core/playwright, jest-axe, vitest-axe, pa11y and Lighthouse are described from their documentation."
metadata:
  stage: author
---

# Accessibility tests

Three layers, each catching what the others cannot: a rule engine scans every state a user can
reach, browser checks drive the keyboard and read the accessibility tree, and a short screen
reader pass covers what only a person can judge. Success is a gate that fails on new WCAG A and
AA violations, browser checks shown to fail on a seeded bug, and a recorded manual pass for the
flows that matter.

## What each layer can decide

| Layer | Decides | Cannot decide |
| --- | --- | --- |
| Rule engine (axe-core, pa11y, Lighthouse) | Missing names, labels and alt; invalid ARIA; contrast of plain text on solid backgrounds; duplicate ids in ARIA references; page language; target size | Anything that needs interaction, intent or judgment: focus order and visibility, traps, Escape, focus return, missing error wiring, announcements, reflow, motion, alt text quality |
| Browser checks (key presses, accessibility tree, viewport and media emulation) | Tab reaches every control in order, visible focus, dialog focus management, accessible description of a field, live regions, 320 px reflow, reduced motion | Whether the experience makes sense when heard |
| Manual screen reader pass | What is announced, in what order, and whether it is usable | Regressions between passes |

A clean engine run means "no detectable violations", not "accessible". Rule engines decide only
the criteria that reduce to DOM facts and computed style; published coverage figures differ with
how they count (success criteria versus issue volume), so never quote one as a guarantee. In this
repository's example, a page carrying nine of the fourteen seeded bugs passes axe with zero
violations.

## Process

1. **Fix the target.** WCAG 2.2 AA unless a contract names another version; regulations often cite
   2.0 or 2.1 AA, and 2.2 AA covers them except 4.1.1 Parsing, which 2.2 removed. List the user
   flows and the components with real risk (custom widgets, dialogs, forms, data tables, media,
   drag and drop). Read [references/wcag-map.md](references/wcag-map.md) to turn each risk into a
   criterion and a check.
2. **Assign each check a layer.**

   | Check | Layer |
   | --- | --- |
   | Names, roles, labels, ARIA wiring of one component | Component test with axe and role queries (`test-component`) |
   | Contrast, focus visibility, reflow, target size, layout-dependent rules | Real browser: jsdom has no layout, and axe under jsdom reports contrast as `incomplete` |
   | Keyboard paths, dialog focus, announcements, error wiring | Browser checks with key presses and the accessibility tree |
   | Every page and state on a schedule | A crawler (pa11y-ci, Lighthouse CI) or exploration (`test-explore`) |
   | What a screen reader says | Manual protocol per release |

3. **Scan every state, not the page as loaded.** A rule engine sees only what is rendered when it
   runs: closed dialogs, collapsed menus and unshown errors are not scanned. Enumerate the states
   (dialog open, menu expanded, validation errors shown, toast visible, empty, loading, failed,
   signed in, each breakpoint, dark theme) and scan after driving into each. For coverage of states
   nobody listed, run the generic accessibility properties of `test-explore` (`controlsHaveNames`,
   `focusStaysInModal`, `noSeriousAccessibilityIssues`) after every generated action.
4. **Configure the engine explicitly.** Run with `runOnly` tags `wcag2a`, `wcag2aa`, `wcag21a`,
   `wcag21aa`, `wcag22aa`: a default axe-core 4.14 run skips `target-size` (2.5.8, the only
   `wcag22aa` rule). Report `best-practice` separately as advisory. Treat `incomplete` as a review
   queue, never as a pass. Exclude a named third-party region with a reason and an expiry, never a
   rule globally. Read [references/automated.md](references/automated.md) for setup per runner.
5. **Baseline existing debt, fail only on new violations.** Fingerprint each violation as rule
   plus target selector plus page and state, record the current set, and fail when a scan adds
   one. Fail on resolved entries too until they are deleted, so the baseline only shrinks. Every
   entry has an owner; new code never enters the baseline. Re-record only in a reviewed diff.
6. **Write the browser checks the engine cannot make.** For every interactive surface touched:
   - Tab from the top reaches every control in reading order and eventually leaves the document
     (no trap); every stop shows a focus indicator.
   - Custom controls activate with Enter and Space; composite widgets (tabs, menus, listboxes,
     grids) take one tab stop and move with arrow keys.
   - Opening a dialog moves focus inside, Tab and Shift+Tab stay inside, Escape closes it, focus
     returns to the opener.
   - Skip links move focus to the main content; a sticky header never covers the focused element
     (2.4.11).

   Press real keys; `element.focus()` skips the very handlers under test. Read
   [references/keyboard.md](references/keyboard.md) for the code.
7. **Assert names, descriptions and announcements from the accessibility tree, not attributes.**
   Query by role and name (`getByRole("button", { name: "Open menu" })` fails when the name is
   missing), and assert `toHaveAccessibleName` and `toHaveAccessibleDescription` (Playwright
   Test, jest-dom), or `toHaveAccessibleErrorMessage` when the field uses `aria-errormessage`. An
   `aria-describedby` pointing at a missing id passes an attribute check and fails a description
   check. For status messages, assert the live region exists before the update and holds the
   message after it; a region inserted together with its text is often not announced.
8. **Check forms as a user meets them.** Each field has a visible label that is its accessible
   name; required is exposed (`required` or `aria-required`); after a failed submit the field is
   `aria-invalid` and its accessible description is the error text, focus moves to the first
   invalid field or to an error summary, and color is not the only signal.
9. **Check visual criteria in a real browser.** Contrast with the engine in the browser; text over
   images or gradients comes back `incomplete` and goes to the manual pass. Reflow: at a 320 CSS
   pixel wide viewport (400% zoom of 1280) nothing scrolls sideways except content that needs two
   dimensions (data tables, maps). Text spacing (1.4.12): inject the spacing stylesheet and assert
   no clipped text. Motion: emulate `reducedMotion: "reduce"` and assert no running animations, or
   only ones with a pause control. Non-text contrast of focus rings and borders (1.4.11) is not in
   axe: compute it or review it with `test-visual`.
10. **Prove each check bites.** Seed the bug the check exists for (remove the label, `outline:
    none`, drop the Escape handler, swap the `button` for a `div`) and watch it fail for that
    reason, then restore. A check that passes on the broken page is deleted or rewritten.
11. **Run the screen reader smoke pass** on the flows that matter, once per release and after any
    change to a custom widget, with one screen reader and browser pairing per platform the users
    have. Read [references/manual.md](references/manual.md) for the protocol and a ten-minute
    script; record the result, and pin every finding with an automated check where one can exist.
12. **Set the cadence.**

    | When | What | Gate |
    | --- | --- | --- |
    | Every change | Component axe and role queries; browser scans of the changed pages in each state; keyboard checks of touched widgets | New A or AA violations and failed browser checks block |
    | Scheduled (nightly or weekly) | Crawl every route; exploration with accessibility properties; reflow and motion across viewports | Findings filed, baseline diff reviewed |
    | Per release | Manual screen reader smoke of the top flows | Recorded pass or filed findings |

## References

- [references/automated.md](references/automated.md): engine setup per runner (raw axe-core,
  @axe-core/playwright, jest-axe and vitest-axe, pa11y-ci, Lighthouse CI), tags, results,
  excludes and the baseline code. Read before adding or changing a scan.
- [references/keyboard.md](references/keyboard.md): tab walks, focus visibility, dialogs, skip
  links, roving tabindex, focus not obscured, reflow and motion, in Playwright. Read before
  writing a browser check.
- [references/manual.md](references/manual.md): the screen reader smoke protocol, key commands
  and a results template. Read before a release pass.
- [references/wcag-map.md](references/wcag-map.md): WCAG 2.2 A and AA criteria mapped to risk,
  axe rule and check. Read when planning coverage or triaging what a scan misses.

## Measured in this repository

`examples/accessibility/verify.mjs` drives `examples/accessibility/page.html`, a small shop page
with fourteen bugs switched on by `?bugs=`, in Chromium with playwright-core 1.64 and axe-core
4.14 (27 claims, exits 0 only when all hold):

- axe with the WCAG tags finds all five markup and style bugs: an unnamed icon button, a missing
  alt, an unlabelled field and low-contrast text on load, and an unlabelled field inside the
  dialog, reported only once the dialog is open. The contrast bug also hits the error text,
  reported only after a failed submit. Neither state-only violation appears in the scan of the
  page as loaded.
- With the nine other bugs seeded (a `div` button, `outline: none`, no focus trap, Escape ignored,
  focus not returned, error not linked to its field, status text outside a live region, a fixed
  width that scrolls sideways at 320 px, an animation that ignores reduced motion), axe reports
  zero violations in all three states. Nine browser checks catch one bug each.
- The fixed page has zero violations in every state and passes all nine checks.
- A baseline recorded with two known violations fails only on a newly added one and lists the
  fixed one as resolved.
- A default `axe.run` does not run `target-size`; with the `wcag22aa` tag it flags two 16 px
  buttons.
- axe under jsdom 30 reports the low-contrast text as `incomplete`, not as a violation.

Nothing here measures screen reader output: the manual protocol is a procedure, not a result.

## Anti-patterns

- Calling a page accessible because the scan is clean, or quoting an automation coverage
  percentage as a guarantee.
- Scanning only the page as loaded; dialogs, menus and errors are where the bugs live.
- Running contrast in jsdom and reading the absence of a violation as a pass.
- Disabling a rule globally to get green, or baselining violations in new code.
- Asserting `aria-*` attributes instead of the computed name, description and role.
- Adding `role="button"` to a `div` and stopping: it still needs a tab stop and Enter and Space.
- Positive `tabindex` to fix focus order; fix the DOM order instead.
- Testing focus traps with `element.focus()` instead of key presses.
- A whole-page accessibility tree snapshot as the only check: it breaks on every copy change and
  gets updated without reading.
- "Screen reader testing" done by reading the markup.

## Done when

- The WCAG target, the flows and the states to scan are written down; each state is scanned with
  the WCAG tags, and `incomplete` results are reviewed.
- Existing violations are baselined with owners; the gate fails only on new ones and resolved ones
  shrink the baseline.
- Keyboard, name and description, live region, form error, reflow and motion checks exist for the
  touched surfaces, and each was shown failing on a seeded bug.
- Contrast is checked in a real browser.
- A screen reader smoke pass is recorded for the release's top flows, or explicitly deferred.
- The per-change, scheduled and per-release cadence is wired or explicitly deferred.

Pin component-level checks with `test-component`; triage scan and manual findings with `test-findings`.
