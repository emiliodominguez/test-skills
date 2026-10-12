# Bombadil runner

A small script (`scripts/bombadil.mjs` or similar) that owns everything around the Bombadil
process. Keep its pure parts (option parsing, policy classification, trace parsing, shrinking)
in modules with unit tests.

## Responsibilities

1. **Parse options** with defaults: spec name (default an "explore everything" spec), time limit
   (default 3m), keep-going, headed, viewport or preset, locale, seed, fault profile, data set,
   output folder (default `out/bombadil/<spec>`), skip-build, reproduce, confirm, shrink.
2. **Build** the app once unless told to reuse the last build.
3. **Bundle the spec.** Bombadil's loader follows only imports with explicit extensions and its
   JavaScript engine has no Node APIs and no `Intl`. Bundle each top-level spec to one ES module
   with the Bombadil package external:

   ```js
   await build({
   	configFile: false,
   	logLevel: "warn",
   	build: {
   		outDir,
   		emptyOutDir: false,
   		minify: false,
   		target: "esnext",
   		lib: { entry: specPath, formats: ["es"], fileName: function fileName() { return `${name}.mjs`; } },
   		rollupOptions: {
   			external: function isBombadil(id) {
   				return id === "@antithesishq/bombadil" || id.startsWith("@antithesishq/bombadil/");
   			},
   		},
   	},
   });
   ```

   Anything that needs `Intl` or the app's validators (value sets, near misses, catalogs) can be
   computed at bundle time in Node and inlined as JSON literals. Export data only; a function
   cannot cross that boundary. Values fixed at bundle time also keep replays identical.
4. **Start a session.** Temporary scratch folder, free port, fresh seeded store, fake hardware,
   seeded fault-injection config, locale. Launch the app with the DevTools port, fence its side
   effects, inject the page kit, apply viewport, zoom and color scheme, then reload.
5. **Write `run.json`** next to the trace: spec, locale, presets, viewport, seed, fault rules,
   data set, coverage mode, performance thresholds. Reproduce, confirm, shrink and triage read it
   so they repeat the same setup.
6. **Spawn the platform binary directly.** The npm launcher runs the binary as a child that a
   signal to the launcher leaves running. Resolve
   `node_modules/@antithesishq/bombadil/binaries/bombadil-<platform>-<arch>` (follow symlinks)
   and spawn that, so a stop request reaches Bombadil.
7. **Arguments** for an attached app:

   ```text
   browser test-external <origin> <bundle.mjs>
     --remote-debugger http://127.0.0.1:<port>
     --output-path <out> --output-path-overwrite
     --width <w> --height <h> --device-scale-factor <scale>
     --time-limit <limit> [--exit-on-violation]
   ```

   For a replay: same setup plus `--reproduce <out>`; it conflicts with `--time-limit` and
   `--exit-on-violation`.
8. **Watchdog.** Bombadil can hang after a failed quiescence check. Send SIGINT when there is no
   output for about 2 minutes or the run is 2 minutes past its limit, then SIGKILL after 15
   seconds. Keep the partial trace.
9. **Parse results.** Lines matching `/^(\w+) was violated:/` name violated properties; "reproduction
   and original test diverged" marks a failed replay. The trace (`trace.jsonl`) has one line per
   state with the action, URL, extractor snapshots and violations.
10. **Apply the finding policy** (see below) and exit `0`, `1` or `2` like Bombadil.
11. **Report coverage and stats:** per extractor, the states where it returned data; the
    properties never reached; states per minute, distinct places, actions per generator, most
    frequent dead states.

## Finding policy

A JSON file decides what a violation does:

```json
{
	"default": "stop",
	"properties": {
		"noSeriousAccessibilityIssues": "record",
		"interactionsStayResponsive": "record",
		"callsPerActionBounded": "record"
	},
	"known": [{ "property": "labelsNotCutOff", "screen": "reports", "reason": "tracked in #123", "until": "2026-12-01" }]
}
```

- `stop`: the finding fails the run. Use for deciding properties.
- `record`: listed in the report, the run goes on. Use for measuring properties.
- `ignore`: dropped. Rarely right.
- `known`: a finding with a reason and an expiry date; recorded, not failing, until the date passes.

When anything is `record`, run Bombadil with keep-going and stop the round yourself at the first
`stop`-class violation. Count findings once per property and screen.

## Latency baselines

Write per-screen, per-action p50, p95 and max to `latency.json` each run. A saved baseline lives
in the output folder, per machine, not in version control. Flag a regression when p95 exceeds
twice the baseline by at least 100 ms with at least 10 samples on each side. A regression is a
lead, not a failure. Re-save baselines after changing settling or coverage mode.

## Make it friendly

Expose the common modes as package scripts or editor tasks: explore, headed, accessibility scan,
fault profile, campaign, inspect, reproduce, confirm, shrink and triage packet. People run what
is one command away.
