# Reproduce, confirm and shrink

## Reproduce with Bombadil

```sh
bombadil browser test --reproduce=<output-folder> <origin> <spec>
bombadil browser inspect <output-folder>
```

Use the same options as the original run (spec, viewport, scale, origin, cookies, headers);
`--reproduce` cannot be combined with `--time-limit` or `--exit-on-violation`. Bombadil prints
both commands after each run. A divergence ("reproduction and original test diverged") fails the
replay: the page differed at some step. Check settling, test ids and data before blaming the app.

With a runner that writes the setup next to the trace, `--reproduce <folder>` should start a
fresh app with that setup, so the replay does not depend on remembering flags.

## Confirm

Replay up to the last finding and write `confirmation.json`: for each finding in the original
run, whether it happened again and at which step. Confirm automatically in campaigns before
reporting a finding.

## Shrink with delta debugging

Each check is a fresh-app replay of a candidate step list; it passes when the same property is
violated again.

```text
shrink(steps):
	chunks = 2
	while chunks <= len(steps):
		for each chunk in split(steps, chunks):
			candidate = steps without chunk
			if reproduces(candidate):
				steps = candidate
				chunks = max(chunks - 1, 2)
				restart the loop
		if no chunk could be removed:
			if chunks == len(steps): stop
			chunks = min(chunks * 2, len(steps))
	return steps
```

- Bound the whole shrink with a deadline (for example 20-30 minutes); keep the best list so far.
- Cut the trace to the steps before the first violation before starting.
- Write the result to `minimal/` with a human-readable `steps.md` (action, target label, typed
  text) and the minimal trace.
- Filter by property when a run violated several.

A replay of a candidate must use the original seed for fault injection and dialogs; with fault
rules on, removing steps changes call order, so expect some findings not to shrink.

## From minimal steps to a regression test

Read `steps.md` and write the shortest deterministic test that shows the bug at the lowest layer:
a unit test if the minimal steps point at a calculation or parser, a flow test if they need
services, a scripted tour only if the bug lives in the UI wiring. Show it failing before the fix.
