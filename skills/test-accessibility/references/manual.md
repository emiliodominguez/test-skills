# Screen reader smoke protocol

A short, repeatable pass by a person, for what no automated check can judge: what is announced,
in what order, and whether a flow is usable by ear. This is a procedure; nothing in this
repository measures screen reader output.

## When and what

- Once per release on the top flows (sign in, search, checkout, the main form), and after any
  change to a custom widget, dialog or live region.
- About ten minutes per flow per pairing. Two pairings cover most users: NVDA with Firefox or
  Chrome on Windows, and VoiceOver with Safari on macOS. Add VoiceOver on iOS Safari or TalkBack
  on Android Chrome when the flow ships to mobile web. Add JAWS with Chrome when users or a
  contract require it.
- Default screen reader settings, the production build, a clean profile. Record versions: screen
  readers and browsers change announcements between releases.

## Setup

| Pairing | Start | See what is spoken |
| --- | --- | --- |
| NVDA + Firefox or Chrome | Control+Alt+N | NVDA menu (NVDA+N), Tools, Speech Viewer |
| VoiceOver + Safari (macOS) | Command+F5 | VoiceOver Utility, Visuals, Caption Panel |
| VoiceOver + Safari (iOS) | Settings, Accessibility, VoiceOver | Screen Curtain off; record the screen with audio |
| TalkBack + Chrome (Android) | Settings, Accessibility, TalkBack | Record the screen with audio |

Safari on macOS skips links and buttons on Tab by default: enable "Press Tab to highlight each
item" in Safari's advanced settings, or the pass reports false keyboard failures.

## Keys used in the script

| Action | NVDA (NVDA key is Insert) | VoiceOver macOS (VO is Control+Option) |
| --- | --- | --- |
| Next or previous heading | H, Shift+H | VO+Command+H |
| Next landmark | D | Rotor (VO+U), Landmarks |
| Next form field | F | Rotor, Form Controls |
| List of headings, links, landmarks | NVDA+F7 | VO+U |
| Read next item | Down Arrow | VO+Right Arrow |
| Activate | Enter or Space | VO+Space |
| Switch browse and focus mode | NVDA+Space | Not applicable (VO+Shift+Down Arrow to interact with a group) |
| Stop speech | Control | Control |

On iOS VoiceOver and TalkBack: swipe right and left to move, double tap to activate, rotor or
reading controls to jump by heading.

## Script

For each step, note what was announced, verbatim where it matters.

1. **Load the page.** The title is announced and names the page. On a client-side route change,
   the new title is set and focus or an announcement tells the user the page changed.
2. **Headings.** Open the headings list: one level 1 heading naming the page; levels describe the
   structure; nothing that looks like a heading is missing from the list.
3. **Landmarks.** Jump by landmark: banner, navigation, main and footer are present; repeated
   landmarks (two navigation regions) have distinct names.
4. **Tab through the flow.** Each control announces a name that matches its visible label, its
   role and its state (expanded, pressed, checked, selected, disabled, required). Icon-only
   buttons say what they do, not "button" or the icon's file name.
5. **Read the content with arrow keys.** Images say something useful or nothing when decorative;
   the reading order matches the visual order; no stray "clickable" or "blank".
6. **Fill the form wrong, then right.** On focus each field reads its label, required state and
   hint. Submitting with errors announces them or moves focus to the first one or to a summary;
   returning to a field reads its error. After fixing, the error is gone from the announcement.
7. **Trigger an asynchronous update** (add to cart, save, filter results). The outcome is
   announced once, without moving focus.
8. **Open a dialog.** Its role and name are announced and focus is inside. Arrow keys in browse
   mode do not wander into the page behind. Escape closes it and focus is back on the trigger,
   which is announced.
9. **Use each custom widget** (tabs, menu, combobox, date picker, grid) the way its ARIA pattern
   says: arrow keys move, selection is announced, and NVDA switches to focus mode where typing or
   arrows must reach the widget.

## Record

| Flow | Step | Pairing and versions | Expected | Announced | Result |
| --- | --- | --- | --- | --- | --- |
| Checkout | 6 | NVDA 2025.x, Firefox 14x | "Email, edit, required, invalid entry, Enter an email address" | "Email, edit, required" | Fail: error not read on return |

Keep the table next to the release notes. A step that was not run is marked "not run", not
"pass".

## After the pass

- Triage each failure with `test-findings`: reproduce in a second pairing before blaming the
  code, since some announcements differ by screen reader and are not bugs.
- Pin what can be automated: a wrong name becomes a role-and-name query, a missing error becomes
  a description assertion, a silent update becomes a live region check (see
  [keyboard.md](keyboard.md)). What remains manual stays in the script.
- Never fix for one screen reader's quirk with markup that breaks the standard pattern for others.
