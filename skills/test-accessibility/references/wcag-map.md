# WCAG 2.2 A and AA map

Each row: the criterion, the risk that usually breaks it, what axe-core 4.14 checks (rule ids
read from its rule tags), and the check that covers the rest. "Browser" means a scripted check in
a real browser ([keyboard.md](keyboard.md)); "Manual" means the screen reader pass or a person
reviewing ([manual.md](manual.md)). An axe rule existing for a criterion does not mean the
criterion is covered: most rules decide presence, not quality. Every WCAG 2.2 level A and AA
criterion has a row; criteria with no automated or scripted check are marked Manual or Review.

## Perceivable

| Criterion | Risk | axe rules | Rest of the check |
| --- | --- | --- | --- |
| 1.1.1 Non-text content (A) | Icon without a name, image without alt, meaningless alt | `image-alt`, `svg-img-alt`, `role-img-alt`, `input-image-alt`, `object-alt` | Manual: alt says what the image means; decorative images are silent |
| 1.2.1 Audio-only and video-only (prerecorded) (A) | Podcast without a transcript, silent demo video without a description | None (`audio-caption` is deprecated and off) | Manual: a transcript or an equivalent exists and matches |
| 1.2.2 Captions (A), 1.2.5 Audio description (AA) | Video without captions or description | `video-caption` (1.2.2 only, presence of a track) | Manual: captions are accurate and synchronized |
| 1.2.3 Audio description or media alternative (A) | Video whose visuals carry information with no description or text alternative | None | Manual: description track or full text alternative |
| 1.2.4 Captions (live) (AA) | Live stream or webinar without captions | None | Manual: live captions are on during the event |
| 1.3.1 Info and relationships (A) | Visual structure missing from markup: fake headings, lists, tables, unlinked errors | `list`, `listitem`, `definition-list`, `th-has-data-cells`, `td-headers-attr`, `aria-required-children`, `aria-required-parent` | Browser: error text is the field's accessible description; Manual: headings list matches the visual structure |
| 1.3.2 Meaningful sequence (A) | CSS order differs from DOM order | None | Browser: tab walk order; Manual: read with arrows |
| 1.3.3 Sensory characteristics (A) | "Click the round button on the right", "the green one" | None | Review instructions and copy |
| 1.3.4 Orientation (AA) | Layout locked to portrait or landscape | `css-orientation-lock` (experimental, off by default) | Browser: render both orientations |
| 1.3.5 Identify input purpose (AA) | Personal data fields without `autocomplete` | `autocomplete-valid` (validity only) | Review: every personal field has the right token |
| 1.4.1 Use of color (A) | Error or link shown by color alone | `link-in-text-block` | Manual or `test-visual`: errors carry an icon or text |
| 1.4.2 Audio control (A) | Autoplaying sound | `no-autoplay-audio` | None |
| 1.4.3 Contrast (minimum) (AA) | Light gray text, placeholder as label, text over images | `color-contrast` (real browser only; images and gradients come back `incomplete`) | Manual for `incomplete`; scan each theme and state |
| 1.4.4 Resize text (AA) | Zoom blocked, text in fixed-height boxes | `meta-viewport` | Browser: 200% zoom, no clipped text |
| 1.4.5 Images of text (AA) | Headings, buttons or banners rendered as images | None | Review: real text unless the image is essential (logos) |
| 1.4.10 Reflow (AA) | Fixed widths, wide tables in page flow | None | Browser: 320 CSS px viewport, no sideways scroll |
| 1.4.11 Non-text contrast (AA) | Faint focus rings, input borders, icon buttons | None | Compute contrast of rings and borders, or review with `test-visual` |
| 1.4.12 Text spacing (AA) | Clipped text under user spacing | `avoid-inline-spacing` (inline `!important` only) | Browser: inject the spacing stylesheet, assert no clipping |
| 1.4.13 Content on hover or focus (AA) | Tooltips that vanish under the pointer or cannot be dismissed | None | Browser: Escape dismisses, hovering the tooltip keeps it |

## Operable

| Criterion | Risk | axe rules | Rest of the check |
| --- | --- | --- | --- |
| 2.1.1 Keyboard (A) | Click-only `div`, drag-only control, scroll region without focus | `scrollable-region-focusable`, `frame-focusable-content`, `server-side-image-map` | Browser: tab walk reaches every control; Enter and Space activate |
| 2.1.2 No keyboard trap (A) | Embedded editors, iframes, custom dialogs | None | Browser: tab walk leaves the document |
| 2.1.4 Character key shortcuts (A) | Single-letter shortcuts fire while typing | None | Browser: type the letter in a field, nothing else happens |
| 2.2.1 Timing adjustable (A) | Session timeout without warning, auto-advancing carousels | `meta-refresh` | Review timeouts; Browser: a warning appears and extends |
| 2.2.2 Pause, stop, hide (A) | Infinite animations, auto-scrolling content | `blink`, `marquee` | Browser: reduced motion stops them, or a pause control exists |
| 2.3.1 Three flashes (A) | Flashing video or animation | None | Manual |
| 2.4.1 Bypass blocks (A) | No skip link or landmarks | `bypass` (a heading or landmark satisfies it) | Browser: skip link moves focus to main |
| 2.4.2 Page titled (A) | Same title on every route | `document-title` (presence) | Browser: title changes on route change |
| 2.4.3 Focus order (A) | Dialog opens without moving focus, focus lost after close or delete | None | Browser: dialog focus in, trapped, returned |
| 2.4.4 Link purpose (A) | "Click here", icon links | `link-name`, `area-alt` (presence) | Manual: links make sense from the links list |
| 2.4.5 Multiple ways (AA) | A page reachable only through one path (no search, sitemap or navigation) | None | Review the site structure |
| 2.4.6 Headings and labels (AA) | Vague labels | None (`empty-heading` is best practice) | Manual |
| 2.4.7 Focus visible (AA) | `outline: none` without a replacement | None | Browser: every tab stop has an indicator |
| 2.4.11 Focus not obscured (minimum) (AA, new in 2.2) | Sticky header or cookie banner covers the focused element | None | Browser: focused rectangle not fully covered |
| 2.5.1 Pointer gestures (A), 2.5.7 Dragging movements (AA, new in 2.2) | Pinch, swipe or drag with no single-pointer alternative | None | Browser: the action works with clicks or buttons |
| 2.5.2 Pointer cancellation (A) | Actions fire on mouse down | None | Browser: press, move away, release, nothing happens |
| 2.5.3 Label in name (A) | Accessible name does not contain the visible label (breaks voice control) | `label-content-name-mismatch` | Manual for icon buttons with visible text |
| 2.5.4 Motion actuation (A) | Shake to undo, tilt to scroll, with no control or way to turn it off | None | Manual on a device; Review: a button alternative and a disable setting exist |
| 2.5.8 Target size (minimum) (AA, new in 2.2) | Small, crowded icon buttons | `target-size` (only with the `wcag22aa` tag) | None beyond the scan |

## Understandable

| Criterion | Risk | axe rules | Rest of the check |
| --- | --- | --- | --- |
| 3.1.1 Language of page (A) | Missing or wrong `lang` | `html-has-lang`, `html-lang-valid` | Review per locale |
| 3.1.2 Language of parts (AA) | Quotes in another language | `valid-lang` (validity only) | Manual |
| 3.2.1 On focus (A), 3.2.2 On input (A) | Focusing or changing a field navigates or submits | None | Browser: tab through and change each field, URL and focus stay |
| 3.2.3 Consistent navigation (AA) | Navigation order changes between pages | None | Review across templates |
| 3.2.4 Consistent identification (AA) | The same function labelled differently on different pages | None | Review across templates |
| 3.2.6 Consistent help (A, new in 2.2) | Help link moves between pages | None | Review across templates |
| 3.3.1 Error identification (A) | Error shown but not tied to the field | None | Browser: `aria-invalid` and accessible description equal the error |
| 3.3.2 Labels or instructions (A) | Placeholder as the only label, format hints missing | `form-field-multiple-labels` (axe tags `label` with 4.1.2 only) | Manual: hints are visible and read |
| 3.3.3 Error suggestion (AA) | "Invalid input" without a fix | None | Review error copy |
| 3.3.4 Error prevention (AA) | Irreversible submit without review or undo | None | Browser: confirm step or undo exists |
| 3.3.7 Redundant entry (A, new in 2.2) | Re-asking for data given earlier in the flow | None | Review the flow |
| 3.3.8 Accessible authentication (minimum) (AA, new in 2.2) | Paste blocked in password fields, cognitive puzzles | None | Browser: paste works, `autocomplete` tokens present |

## Robust

| Criterion | Risk | axe rules | Rest of the check |
| --- | --- | --- | --- |
| 4.1.2 Name, role, value (A) | Unnamed buttons and fields, invalid ARIA, states not updated | `button-name`, `label`, `select-name`, `aria-*` rules, `nested-interactive`, `aria-hidden-focus`, `frame-title`, `summary-name` | Browser: `aria-expanded`, `aria-pressed`, `aria-selected` change with the interaction |
| 4.1.3 Status messages (AA) | Toasts, cart counts and result counts not announced | None | Browser: text lands in a live region that existed before the update; Manual: announced once |

4.1.1 Parsing was removed in WCAG 2.2; duplicate ids that break ARIA references are still caught
by `duplicate-id-aria` under 4.1.2.
