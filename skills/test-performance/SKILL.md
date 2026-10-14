---
name: test-performance
description: "Performance tests that catch regressions without flaking: counts, scaling ratios, benchmarks, load, web budgets. Use when code got slow, N+1 queries, p95, k6, Lighthouse. Hands off to `test-flaky` or `test-findings`."
compatibility: "Count and ratio checks measured with Vitest 5.0.3 on Node 22 in this repository's examples; Vitest 5 `bench` API checked by running it. Load, browser and other-language tools are described from their documentation."
metadata:
  stage: author
---

# Performance tests

Catch a regression in cost without a check that fails on machine noise. Success is: every
performance risk has a check that failed on a seeded regression and passes on the fix. The check
runs where its noise allows: deterministic counts and ratios on every change, benchmarks and load
on dedicated or scheduled runs. Thresholds come from measured baselines or SLOs.

## Process

1. **Name the risk, its unit and its cadence** before choosing a tool:

   | Risk | Measure | Check | Runs |
   | --- | --- | --- | --- |
   | Quadratic loop, lookup that became linear | Operations per input item; time ratio at n and 8n | Per-item budget; ratio threshold | Every change |
   | N+1 queries, chatty client | Queries or requests per operation | Constant budget at two sizes | Every change |
   | Allocation growth on a hot path | Allocations per call (`testing.AllocsPerRun`, memory diagnosers) | Exact or ratcheted count | Every change |
   | Hot function got slower | Benchmark against a baseline from the same machine | Effect size plus significance | Dedicated runner, per merge or nightly |
   | Endpoint latency under load | p95, p99, error rate at a target arrival rate | SLO thresholds | Scheduled, before release |
   | Page load and responsiveness | LCP, CLS, TBT in the lab; LCP, INP, CLS at p75 in the field | Lab assertions on the median of runs | Lab per change, field dashboards |
   | Bundle growth | Compressed bytes per entry point | Size budget | Every change |
   | Memory leak | Retained heap after repeated cycles | Growth per cycle near zero | Per change or nightly |

2. **Count instead of timing on every change.** A count catches algorithmic and chatty
   regressions deterministically, with no clock involved. Count at a boundary you can observe: queries through the driver's log or event hook, requests through a fake
   server, renders, cache misses, key or comparator calls through an injected callback. Assert
   at two sizes so the budget states the growth, not a snapshot: "2 queries for 3 orders and
   for 30" catches N+1, "at most 2 key calls per item at 100 and 1000 items" catches quadratic.
   Read [references/counting.md](references/counting.md) for query counters per stack.
3. **When only time shows it, assert a scaling ratio.** Time the same operation at n and 8n in
   the same process. Expected ratios: about 8 for O(n), about 10 for O(n log n), about 64 for
   O(n²); a threshold of 24 needs noise to move a ratio more than twofold. Warm up first.
   Calibrate repetitions until the small sample takes 0.2 ms or more. Interleave small and large
   samples. Take the fastest of 15 or more: noise only adds time. Build inputs outside the timed
   region and consume each result. Pick n so the slow variant's large sample stays under about
   50 ms. Never assert `elapsed < X ms` in a shared job.
4. **Benchmarks compare; they do not assert absolute times.** Use the ecosystem's harness:
   Vitest bench or tinybench, pytest-benchmark, Go `testing.B` with benchstat, criterion,
   JMH, BenchmarkDotNet. Run base and head in the same job on the same machine, interleaved.
   Take enough samples for a confidence interval. Flag a regression only when the change exceeds
   a minimum effect (5-10% typical) and is statistically significant. On shared runners, count
   instructions (Cachegrind-based harnesses) instead of time. Read
   [references/benchmarks.md](references/benchmarks.md) for setup and statistics per language.
5. **Load tests answer SLO questions, on a schedule.**
   - Model public traffic as open: requests arrive at a rate whether or not earlier ones
     finished (k6 `constant-arrival-rate`, Gatling `constantUsersPerSec`, Artillery
     `arrivalRate`).
   - A closed model (fixed users looping) slows its own requests when the system slows. That
     hides the tail: coordinated omission.
   - Shapes: smoke (minutes, every deploy), load (expected peak, 15-30 min), stress (ramp until
     the SLO breaks, to find the knee), spike (sudden 5-10x), soak (hours, for leaks and pool
     exhaustion).
   - Thresholds are the SLO on p95, p99 and error rate, never the mean.
   - Run against production-like data from a generator that is not itself saturated.

   Read [references/load.md](references/load.md) for a k6 script, the other tools and
   coordinated omission.
6. **Frontend budgets: lab per change, field for truth.**
   - Lab: Lighthouse CI asserts LCP, CLS and TBT on the median of at least 3-5 runs with a
     fixed device and throttling profile.
   - Field (RUM) judges p75 against the Core Web Vitals thresholds (LCP 2.5 s, INP 200 ms,
     CLS 0.1). INP exists only in the field; TBT is its lab proxy.
   - Budget compressed bundle bytes per entry point.
   - Record long tasks over 50 ms during end-to-end flows.
   - Detect leaks by repeating a navigation cycle, collecting garbage, and asserting the
     retained heap and detached nodes do not grow per cycle.

   Read [references/frontend.md](references/frontend.md).
7. **Set thresholds from measurements.**
   - Run the measurement 10-20 times on the runner that will enforce it and record the
     distribution.
   - Timings: about twice the observed maximum, or the SLO.
   - Counts: the current value, ratcheted down when it improves. Raising one needs a reason in
     the change.
   - Store the baseline with the commit and runner it came from. A guessed threshold is either
     flaky or blind.
8. **Control noise where timing is unavoidable.** Use dedicated or pinned runners, a fixed CPU
   governor, no other jobs, multiple samples and same-machine baselines. Read
   [references/noise.md](references/noise.md) before putting any timing check in CI.
9. **Prove each check can fail.** Seed the regression: a rescanning loop, a query inside a loop,
   a dropped index, a heavy dependency in the bundle, a listener never removed. Watch the check
   fail, then revert. For any check that times, measure its pass rate by repetition, alone and
   with parallel copies for contention, using `test-flaky`'s repeat script.
10. **Split measuring from deciding.** Counts, size budgets and wide-margin ratios decide: they
    fail the build. Absolute timings, benchmark trends and load results measure: they are
    recorded and charted, and they fail only when they breach an SLO or a significant,
    reproduced regression.

## Measured in this repository

`test/performance-examples.test.ts` runs against `examples/performance/modules.mjs`, a keyed
dedupe that rescans what it kept and an order loader that queries each order's customer
separately. Functional tests pass on both regressions.

- A budget of 2 key calls per item at 100 and 1,000 items fails the dedupe (5,050 and 500,500
  calls) and passes the fix (100 and 1,000).
- A budget of 2 queries fails the loader (4 and 31 queries for 3 and 30 orders) and passes the
  fix.
- The ratio check uses `examples/performance/scaling.mjs`: n = 200, 8n, the fastest of 15
  interleaved samples of at least 0.2 ms, threshold 24. Quiet, it reads 63-67 on the regression
  and 8.4-10.1 on the fix. The file runs in about 1 s.
- Repeated with `test-flaky`'s repeat script, the file failed 0 of 20 runs alone, 0 of 40 with 4 parallel
  copies and 0 of 30 with 8 parallel copies on a 4-core machine.
- `examples/performance/measure.mjs` ran as six concurrent copies, 120 rounds per variant. The
  fastest-sample ratio misclassified 0 of 120 for each variant: the fix peaked at 12.4 and the
  regression never fell below 63. A ratio of medians misclassified the fix in 40 of 120.
- An earlier setting, the fastest of 7 samples of 0.5 ms, misclassified 1 of 60 contended rounds.
  Short samples, and more of them, removed that.
- Median time per call varied up to 2.5x inside one contended process: 0.013-0.033 ms for the fix.
  An absolute budget would have to sit between that and the regression's 0.14 ms, on this machine
  only; the ratio needs no per-machine number.
- The Vitest bench snippet in [references/benchmarks.md](references/benchmarks.md), run with
  unchanged code against its own stored baseline, reported a regression in 8 of 20 runs (mean up
  to 28% slower, fastest sample within 2%).

Cross-machine variance, the load tools, Lighthouse CI and heap-snapshot procedures were not run
here.

## Anti-patterns

- `expect(elapsed).toBeLessThan(100)` in a unit test on a shared runner: flaky on a busy machine
  and blind to a quadratic loop at test sizes.
- Reporting or asserting average latency: the mean hides the tail users feel.
- A closed-model load test reporting good latency while the system queues requests it never sent.
- Benchmarks without warmup, or whose result is unused and optimized away.
- Comparing against a baseline from another machine, another runner type or last month.
- Thresholds copied from a blog post or set from one run.
- Retrying a performance check until it passes, or widening the threshold after each failure.
- One Lighthouse run per change, or judging INP from a lab run.
- Load generator on the same host as the system, or load against third-party services and
  production without agreement.
- Benchmarking debug builds, or with coverage instrumentation or a profiler attached.

## Done when

- Every listed performance risk has a check, a cadence and a recorded threshold source
  (baseline run, SLO or exact count), or is marked as an accepted gap.
- Each check failed on a seeded regression and passes on the fix.
- Every timing check has a measured pass rate from repetition, including under contention.
- Load results are reported as p95, p99, error rate and achieved rate against the SLO, with the
  workload model stated.
- Commands that were run, and tools described but not run, are stated.

Measure a timing check that flakes with `test-flaky`; report a reproduced regression with `test-findings`.
