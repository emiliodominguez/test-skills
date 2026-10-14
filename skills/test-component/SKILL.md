---
name: test-component
description: "UI component tests with Testing Library, user-event and MSW. Use when testing a React, Vue or Svelte component, form, hook or modal, or fixing act warnings. Hands off to `test-e2e` or `test-findings`."
compatibility: "Verified in this repository's examples with React 19.3, @testing-library/react 16.3, @testing-library/dom 10.4, @testing-library/user-event 14.6, MSW 3.0, axe-core 4.14, jsdom 30 and Vitest 5. The practices carry to Vue, Svelte, Angular, Solid, browser-mode runners, Playwright component testing and Storybook."
metadata:
  stage: author
---

# Component tests

Render one component, or a small tree, with its real providers, and drive it the way a person
does: find controls by role and name, type and click through user events, wait for what appears,
and let only the network be fake. Success is a test that fails when the component breaks for a
person and keeps passing when the markup is refactored.

## Process

1. **Pick the level.** A component test owns one screen region's behavior: rendering per state,
   interaction, validation, focus, and how it talks to its data layer.

   | The risk is in | Test it with |
   | --- | --- |
   | A pure rule (formatting, totals, validation logic) | `test-unit`, then one component test that shows the result |
   | Rendering, interaction, states, keyboard and ARIA of one component or form | This skill |
   | The real API, database or service contract behind the component | `test-integration` |
   | A path across pages, auth, real backend, routing in the built app | `test-e2e` |
   | Layout, real CSS, scrolling, contrast, pixels | A browser runner (step 2), `test-visual`, `test-accessibility` |

   Move logic out of the component when a test needs a full render to check arithmetic.
2. **Use the repository's runner and environment.** jsdom by default; happy-dom only when the
   suite already uses it; a browser runner (Vitest browser mode, Playwright component testing,
   Storybook interaction tests) when the behavior needs layout, real focus, canvas or observers.
   Check the setup before writing tests: React Testing Library registers automatic cleanup and
   the act environment only through the runner's globals, and Vitest's default is no globals.
   Without a setup file that calls `cleanup` and sets `IS_REACT_ACT_ENVIRONMENT`, trees leak
   between tests and act warnings stay silent (measured below). Read
   [references/frameworks.md](references/frameworks.md) for the environment table, jsdom's gaps
   and per-framework notes (React, Vue, Svelte, Angular, Solid, Storybook).
3. **Render with real providers, fresh per test.** One `renderWithProviders` helper builds a new
   store, query client (retries off) and memory router per render and returns
   `userEvent.setup()` created before render. Never share a store or cache between tests. Test
   hooks through a component that uses them; `renderHook` only for a hook that is a public API.
4. **Query like a person.** Role and accessible name, then label, then text; a test id only for
   a region with no accessible handle, with the reason written down; never CSS classes, tag
   paths or component internals. When the role query cannot find a visible control, that is a
   defect in the component (a clickable `div`, an icon button with no name, an unlabelled
   field): fix it or report it, do not fall back to a test id. Read
   [references/queries.md](references/queries.md) for the priority table, implicit roles and
   scoping with `within`.
5. **Act like a person.** user-event for every interaction; await every call. One keyboard path
   per interactive component: Tab reaches it, Enter or Space activates it, Escape dismisses it,
   focus returns to the trigger. `fireEvent` only for events user-event cannot produce (scroll,
   resize, media and custom events): it dispatches one event and runs no default action.
6. **Wait on what appears.** `findBy` for elements, `waitFor` with one assertion for state
   changes, `waitForElementToBeRemoved` for spinners. No fixed sleeps. Assert absence only after
   the settled state is on screen. With fake timers, configure user-event's `advanceTimers` and
   let the clock advance. An act warning is a race the test lost: await the visible result, do
   not wrap lines in `act` to silence it. Read [references/async.md](references/async.md) for
   fake timers, the act setup and failing on `console.error`.
7. **Fake the network, not the unit.** Serve HTTP with MSW (or an injected fake client) and fail
   on unhandled requests. Override handlers per test for empty, 4xx, 5xx, network error and
   slow responses; record requests when the payload is the behavior and assert body and count.
   Never mock the component's own hooks, modules or children. Read
   [references/network.md](references/network.md) for setup, the MSW 3 option rename and
   request assertions.
8. **Cover every state the screen has.** Loading, empty, error (with a retry if there is one),
   success, partial data, no permission. For forms: each validation rule shows its message tied
   to the field (`aria-invalid`, `aria-describedby` or `role="alert"`), keyboard submit works,
   the submit is disabled or ignored while pending (no double submit), server errors map to the
   right field, and success clears or redirects.
9. **Check accessibility in the same test.** Run axe-core on the container in each state that
   matters and assert the violation ids equal `[]`, with color contrast disabled in jsdom.
   axe does not replace the keyboard path from step 5. Read
   [references/checks.md](references/checks.md) for axe setup, keyboard and focus checks, and
   snapshot rules.
10. **Prove each test bites.** Break the component the way it would break for real (swap the
    button for a `div`, drop the `response.ok` check, remove the label) and watch the test fail
    for that reason; restore it. A test that survives the break is rewritten or deleted.

## Snapshots

Only for small, stable output a reviewer reads in the diff (a formatted string, a short ARIA
snapshot of one widget), preferably inline. No whole-tree DOM snapshots; pixel comparisons
belong to `test-visual`.

## Measured in this repository

`test/component-examples.test.ts` runs each test style against seeded bugs in
`examples/component/` and asserts the outcome for every variant:

- Coupon form, shipped with "Apply" as a `span` with a click handler. The role query plus
  user-event test fails on it ("Unable to find an accessible element with the role "button"
  and name "Apply"") and passes on the fixed form and on a refactor with new class names and no
  test id. A test id plus `fireEvent` plus CSS class test passes on the bug and fails on that
  harmless refactor. Typing `{Enter}` with user-event submits the fixed form; `fireEvent.keyDown`
  Enter submits nothing on any variant. axe-core reports zero violations on the bug.
- Cart row with an icon-only remove button: axe-core reports `button-name` and the role query
  fails; the labelled fix passes both. Light gray on white is not a contrast violation in jsdom;
  axe puts the rule in `incomplete`.
- Invoice list whose hook ignores `response.ok`: the happy path passes on both variants; an MSW
  500 catches the bug (the buggy list shows "No invoices yet" instead of an error), while a test
  that renders the view with a canned error state passes. With MSW 3.0 `onUnhandledFrame:
  "error"`, an unhandled request rejects. A fixed sleep before an assertion logs one act warning
  with `IS_REACT_ACT_ENVIRONMENT` on and none with it off, which is the state Vitest without
  globals leaves it in.

## Anti-patterns

- Querying by class, tag path or test id when a role and name exist; asserting on component
  state, props or instance methods.
- Shallow rendering, or mocking child components, the component's own hooks or its modules.
- `fireEvent.change` plus `fireEvent.click` as the only interaction: no focus, no keyboard, no
  default actions, so mouse-only controls pass.
- Fixed sleeps, empty `waitFor` calls, side effects inside `waitFor`, absence checks right after
  render.
- Ignoring act warnings, or wrapping lines in `act` until they stop.
- A store, query client or router shared across tests; real network calls allowed through.
- Testing the library: asserting that the router navigates, the form library validates or the
  query cache caches, instead of what the component shows.
- Whole-tree DOM snapshots accepted without reading them.
- Only the happy path: no empty, error, loading or keyboard test.

## Done when

- Each state and interaction in scope has a test that queries by role or label and acts through
  user events, and at least one was shown failing on a deliberate break of the component.
- Unhandled network requests fail the suite, and no act warning or unexpected `console.error`
  is logged; the setup file that guarantees this is named.
- axe-core runs in the meaningful states with zero violations or a reasoned allowlist; checks
  jsdom cannot make (contrast, layout) are listed for a browser runner.
- The run command and the discovered test count are recorded; gaps are listed with the next
  action.

Cover the paths across pages with `test-e2e`, audit whole screens with `test-accessibility`,
and triage failures with `test-findings`.
