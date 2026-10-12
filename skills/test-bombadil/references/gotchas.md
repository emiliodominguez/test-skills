# Bombadil 0.7.x gotchas

Observed behaviors and their workarounds. Re-check them when upgrading.

| Symptom | Cause | Workaround |
| --- | --- | --- |
| Clicks do not replay | Replay matches only test id, id, role with accessible name, or ARIA label; it ignores text | Synthesize stable test ids in the page kit |
| "reproduction and original test diverged" | Element order or content depends on time, history or unsettled rendering | Settle after each action; fold digits in labels; fixed seed and data |
| Typed text does not replay | Replay accepts typing only when the generator at that point would produce the same text | Generate text with Bombadil's string generators (`Regexp`, `Text`, `CharSet`), never runtime randomness |
| Resize, drag, reload or custom actions do not replay | Not in the replayable set | Fix the viewport per run; use custom actions only to get past setup steps |
| Spec fails to load an import | The loader follows only imports with explicit extensions | Bundle each spec into one module, Bombadil package external |
| `Intl` or Node API undefined in a spec | The spec runtime is a bare JavaScript engine | Compute values at bundle time in Node and inline them as JSON |
| The run stops early with nothing to do | No action available in some state | Always export a generator that can return `"Wait"` |
| The run stops on a string | A lone surrogate in an extracted value | Strip `[\uD800-\uDFFF]` in extractors |
| The run hangs with "quiescence timer failed" | Bombadil waiting on a page that never settles | Watchdog: SIGINT on silence, SIGKILL after 15 s |
| Stopping the launcher leaves the browser running | The npm launcher does not forward signals | Spawn the platform binary directly |
| Injected `alert` never shows as a failure | Bombadil answers dialogs itself | Injection sentinels in the page kit |
| Hash-route links are never followed | Default clicks follow `#/` links only over HTTP and never scroll to them | Serve the app over HTTP; add a route generator that scrolls navigation into view |
| No JavaScript coverage | Coverage is measured only for scripts fetched over HTTP | Serve the built renderer from a local HTTP server; disable instrumentation for performance runs |
| Slow scripts trip latency properties | Coverage instrumentation slows execution | Relax performance thresholds when coverage is on |
| Viewport changes after navigation | Emulated size can lapse | Also set the real window size; reset zoom each run |
| Random typing eats the run | Default typing is long and slow | Replace with short fast bursts (see `test-bombadil-spec`) |
| `trace.jsonl already exists` | Output folder reused | Pass `--output-path-overwrite` |
| `--reproduce` rejected | It conflicts with `--time-limit` and `--exit-on-violation` | Drop those flags when replaying |
| An `eventually` fails only when the test ends | Unbounded, it stays pending and is reported as "test ended" at the time limit, far from the cause | Bound it: `eventually(check).within(n, "seconds")` |
| `failed to locate chromium/chrome executable` | No Chrome on PATH or in standard locations | Set `CHROME` to a Chrome or Chromium binary (a test framework's downloaded browser works) |
| `Invalid PermissionDescriptor name: local-network` | Older Chromium builds reject the default `--chrome-grant-permissions` | Pass `--chrome-grant-permissions geolocation` (the bundled runner retries this way and records it) |
| `unexpected argument '--allow-url'` | Added after 0.7.8 | Restrict exploration with gated generators instead, or upgrade |
| Replay refuses to start: trace already exists | A replay writing into the original folder | Write the replay to a new folder; the bundled runner uses `<output>/replay` |
| Replay diverges at a click on a label or plain text | The element has no test id, id, role with name or ARIA label | The page kit's synthesized test ids; verified to move divergence from step 3 to past step 30 |
| Replay diverges after injected markup renders | Broken images and injected nodes change layout timing, so scroll targets differ | Expected for injection payloads; confirm the finding rather than demanding a byte-identical replay |
| Runs stall on apps with service-worker mocks, server-sent events or WebSockets | Quiescence never settles while streams stay open | Close streams in test builds or fake them; keep the watchdog |
| Shift-modified keys, right click and meta shortcuts are not generated | Not in the action set | Expose those features through visible controls in test builds, or test them in scripted tours |
