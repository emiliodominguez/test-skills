# Terminal programs

Bombadil's terminal driver (experimental in 0.7.x) runs a command in a pseudo-terminal, types
into it and checks properties against the rendered screen after every step.

```sh
bombadil terminal test --specification bombadil/cli.ts --time-limit 1m --output-path out/bombadil/cli -- node cli.mjs
node scripts/bombadil-run.mjs --terminal "node cli.mjs" --spec bombadil/cli.ts --time-limit 1m -- --columns 72 --rows 28
```

## Specification API

```ts
import { always } from "@antithesishq/bombadil";
import { actions, extract, weighted, type ActionTemplate } from "@antithesishq/bombadil/terminal";

export * from "@antithesishq/bombadil/terminal/defaults/properties"; // exitSuccess, noReplacementChars

const header = extract(function readHeader(state) {
	return state.grid.rowText(0);
});
```

- State: `state.grid` (`size`, `rowText(i)`, `row(i)` with per-cell style), `state.cursor`
  (position, visibility), `state.exitStatus` (`code`, `signal`) once the program exits.
- Actions: `{ TypeText: { Regexp: "add [a-z]{1,8}\r" } }`, `{ Resize: { columns, rows } }`,
  `{ Click: { row, column } }`, `{ ScrollUp: {} }`, `{ ScrollDown: {} }`. End typed commands
  with `\r`.
- Defaults: `typeBasicInput` from `@antithesishq/bombadil/terminal/defaults` types Unicode and
  control characters, including Ctrl+C and Ctrl+D, which end most programs at once. For an
  interactive program, write command generators and use the default input sparingly.
- No custom actions in the terminal driver.

## What to check

- The defaults: the program exits 0, and nothing it prints renders as U+FFFD (malformed UTF-8,
  often from cutting strings by bytes).
- Screen consistency: counts in a header or status line match the rows shown.
- Prompt recovery: after any input, the prompt reappears within a bound.
- Width: no row exceeds the grid, with `Resize` actions to probe narrow terminals.

## Gotchas

| Symptom | Cause | Workaround |
| --- | --- | --- |
| Bombadil exits 1 although a property was violated | When the program under test exits with an error, the run ends with status 1 | Read the trace for violations; the bundled runner returns 2 when it finds `stop` findings |
| The run ends after a few steps | The program exited: a crash, or Ctrl+D or `quit` typed by a generator | Probe crashing inputs rarely, keep exit commands out of generators, and prefer domain generators over the default input |
| Traces reach gigabytes | Each state stores every cell with its style (about 0.5 MB per state at 100x40) | Shorter runs, a smaller grid (`--columns`, `--rows`), and the runner's `--prune-clean` |
| States are sampled mid-render | Output still streaming when the state is taken | Raise `--quiescence-timeout-ms` above its 5 ms default for programs that draw slowly |
| No inspector | `bombadil browser inspect` is browser-only | Read `trace.jsonl` or the runner's `summary.md` |
