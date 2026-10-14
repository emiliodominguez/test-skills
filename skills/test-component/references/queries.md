# Queries

The Testing Library family (React, Vue, Svelte, Angular, Solid, and the DOM core under them)
shares one query API. Browser-mode runners and Playwright use the same idea with locators
(`page.getByRole`, `getByLabel`). The order below is what a person or a screen reader can use.

## Priority

| Rank | Query | Use for | Notes |
| --- | --- | --- | --- |
| 1 | `getByRole(role, { name })` | Anything interactive or structural: buttons, links, fields, headings, dialogs, lists, alerts, tables | Always pass `name`; a bare role matches too much |
| 2 | `getByLabelText` | Fields, especially ones with no role | `input type="password"` has no ARIA role, so role queries cannot find it |
| 3 | `getByPlaceholderText` | Only when the design has no label | A field with only a placeholder is an accessibility finding; report it |
| 4 | `getByText` | Non-interactive content: messages, values, empty states | Exact match by default; use a regex for partial |
| 5 | `getByDisplayValue` | Pre-filled forms | |
| 6 | `getByAltText`, `getByTitle` | Images, abbreviations | `alt=""` makes an image presentational: no `img` role |
| 7 | `getByTestId` | A region with no accessible handle and none that should exist (a canvas chart, a drag surface) | Write down why; never as a workaround for a missing label |

Never: `container.querySelector` with classes, `nth-child`, tag paths, component instances,
props or internal state. Those break on refactors that change nothing a person sees, and they
pass on markup a keyboard or screen reader cannot use.

## When the role query fails

"Unable to find an accessible element with the role ..." on a control you can see is usually a
real defect: a `div` or `span` with a click handler, an icon button with no name, a label not
associated with its field. Fix the component, or report it, before reaching for a test id. The
error output lists every role and name it found; read it.

## Variants

- `getBy`: exactly one match, throws otherwise. The default.
- `queryBy`: returns `null`. Use only to assert absence, and only after the settled state is
  on screen (see [async.md](async.md)); immediately after render it passes vacuously.
- `findBy`: `waitFor` plus `getBy`, for anything that appears after a promise, timer or effect.
- `getAllBy`, `queryAllBy`, `findAllBy`: lists. Assert the full list of texts in one
  `toEqual`, not the length alone.

## Names and scoping

- The name is the accessible name: label, `aria-labelledby`, `aria-label`, then content.
  `getByRole("button", { name: "Remove Coffee beans" })` proves the name a screen reader reads.
- Scope repeated controls with `within(row)`: find the row by its text, then the button inside.
- `screen` queries `document.body`, which includes portals (modals, popovers, toasts). Queries
  bound to `container` do not.
- Hidden elements (`display: none`, `hidden`, `aria-hidden="true"`) are excluded unless
  `{ hidden: true }`. Component test setups usually do not apply the app's stylesheets, so a
  class that hides something in the browser may not hide it in jsdom: assert visibility through
  the `hidden` attribute or ARIA state, or test it in a browser.
- `*ByRole` builds the accessibility tree and is the slowest query on large trees. Scope with
  `within` first; do not trade it for test ids to save time.

## Implicit roles worth knowing

| Element | Role |
| --- | --- |
| `button`; `input` of type button, submit or reset | `button` |
| `a href` | `link` (without `href`: no link role) |
| `input` text, email, tel, url; `textarea` | `textbox` |
| `input type="search"` | `searchbox` |
| `input type="number"` | `spinbutton` |
| `input type="checkbox"`, `"radio"`, `"range"` | `checkbox`, `radio`, `slider` |
| `select` (single, no size) | `combobox`; its options are `option` |
| `h1` to `h6` | `heading` with `{ level }` |
| `ul`, `ol`, `li` | `list`, `listitem` |
| `table`, `tr`, `th`, `td` | `table`, `row`, `columnheader`, `cell` |
| `dialog`, `role="dialog"` | `dialog` (give it a name with `aria-labelledby`) |
| `form`, `section` | `form`, `region` only when they have an accessible name |
| `nav`, `main`, `header`, `footer` | `navigation`, `main`, `banner`, `contentinfo` (the last two only at page level) |

## Copy and translations

Render with a fixed locale and query by the same message the app uses: export the message
constants or read them from the same catalog, so a copy change updates one place. Hard-coded
copy repeated across tests is how a wording change breaks fifty tests.
