# Buggy CLI

A full-screen todo list for the terminal with three seeded bugs, and a Bombadil terminal
specification that finds them. `TODO_FIXED=1` turns the bugs off.

```sh
pnpm demo:cli         # with bugs: exits 2 and prints the findings
pnpm demo:cli:fixed   # bugs off: exits 0, no findings
```

Needs only Node; no browser.

## The bugs

| Bug           | What happens                                                                | Caught by                               |
| ------------- | --------------------------------------------------------------------------- | --------------------------------------- |
| `byte-cut`    | Titles are cut to 24 UTF-8 bytes, splitting a character and printing U+FFFD | `noReplacementChars` (Bombadil default) |
| `double-done` | Marking a finished item done again lowers the open count again              | `headerMatchesList` (domain)            |
| `zero-crash`  | `done 0` reads before the list and the program crashes                      | `exitSuccess` (Bombadil default)        |

The crash is probed rarely on purpose: a crash ends a terminal run, so a frequent probe would hide
the other two bugs.

## Files

- `todo.mjs` - the program. Each bug is behind `fixed`.
- `bombadil/spec.ts` - Bombadil's terminal default properties, one domain property that reads the
  header and the rows from the screen, and weighted command generators.
