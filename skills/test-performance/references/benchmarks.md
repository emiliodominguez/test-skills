# Micro-benchmarks

A micro-benchmark tells you whether a change made a hot function slower, relative to a baseline
measured the same way on the same machine. It is a measurement, not a correctness test: run it on
a dedicated runner or in a scheduled job, and decide on effect size plus significance.

## Harness per language

| Language | Harness | Baseline and comparison |
| --- | --- | --- |
| JavaScript, TypeScript | Vitest bench (tinybench underneath), tinybench, mitata | Vitest 5: `bench.from` reads a stored result; `writeResult` stores one |
| Python | pytest-benchmark | `--benchmark-autosave`, `--benchmark-compare`, `--benchmark-compare-fail=median:10%` |
| Go | `testing.B` (`for b.Loop()` since Go 1.24), `-benchmem` | `go test -bench . -count 10 > new.txt`; `benchstat old.txt new.txt` reports delta and p-value |
| Rust | criterion; iai-callgrind for instruction counts | `--save-baseline main`, then `--baseline main`; default significance 0.05, noise threshold 1% |
| Java, Kotlin | JMH | `@Warmup`, `@Measurement`, `@Fork(3)`; `Blackhole` to consume results; compare runs with a JMH visualizer or script |
| C#, F# | BenchmarkDotNet | `[Benchmark(Baseline = true)]`, `[MemoryDiagnoser]`; reports ratio to baseline and allocations |

## Vitest 5 bench

Checked by running it with Vitest 5.0.3. The `bench` API is a test-context fixture, valid only in
files matched by `benchmark.include` (default `**/*.{bench,benchmark}.?(c|m)[jt]s?(x)`), run with
`vitest bench`. Using it from an ordinary test file fails with an error that says so, which keeps
benchmarks out of the per-change suite.

```ts
// dedupe.bench.ts. Store the baseline on main: WRITE_BASELINE=1 npx vitest bench --run
// Compare a change against it:                          npx vitest bench --run
import { existsSync } from "node:fs";
import { expect, test } from "vitest";
import { dedupeBy } from "../src/dedupe.js";

const BASELINE = "bench/dedupe.json";
// Above the largest p50 ratio seen in 20 runs of unchanged code on the enforcing runner.
const P50_RATIO_LIMIT = 1.25;
const items = Array.from({ length: 2000 }, function item(_, index) {
	return { sku: `sku-${index % 1500}` };
});

/**
 * Key of an item.
 *
 * @param item - An item.
 * @returns Its SKU.
 */
function skuOf(item: { sku: string }): string {
	return item.sku;
}

/**
 * The operation under measurement.
 *
 * @returns The deduplicated items, consumed by the harness.
 */
function run() {
	return dedupeBy(items, skuOf);
}

test("dedupe p50 stays within the calibrated ratio of the baseline", async function againstBaseline({ bench }) {
	const options = { time: 500, warmupTime: 100 };

	if (process.env.WRITE_BASELINE || !existsSync(BASELINE)) {
		await bench("dedupe", { writeResult: BASELINE }, run).run(options);

		return;
	}

	const result = await bench.compare(bench.from("baseline", BASELINE), bench("dedupe", run), options);
	const ratio = result.get("dedupe").latency.p50 / result.get("baseline").latency.p50;

	expect(ratio).toBeLessThanOrEqual(P50_RATIO_LIMIT);
});
```

- `bench.compare(a, b, options)` prints a table with mean, p75, p99, rme and sample count, and
  returns results whose `latency` carries `mean`, `p50`, `p75`, `p99`, `sd`, `mad` and `rme`.
- Gate on a robust statistic. The built-in `toBeFasterThan` and `toBeSlowerThan` compare mean
  latency with an optional `delta`; with unchanged code against its own stored baseline on a
  shared 4-core machine, `not.toBeSlowerThan(baseline, { delta: 0.1 })` failed 8 of 20 runs (mean
  up to 28% slower, fastest sample within 2%). Keep a mean comparison as a warning that triggers a
  same-job rerun, never as the gate.
- Calibrate the limit: run the unchanged code 20 times against its own baseline on the enforcing
  runner, record the largest p50 ratio, and set the limit above it with margin. Observed, not
  asserted, with the snippet above on a 4-core machine: p50 ratios of at most 1.08 in 20 runs alone
  and 1.04 in 12 runs with four concurrent copies, while the mean exceeded the baseline by more than
  10% in 8 of those 20 runs. The seeded quadratic dedupe read a p50 ratio of about 67 and failed.
- `bench.from` throws when the file is missing, hence the write branch. It reads the stored
  numbers and does not re-run them, so the baseline must come from the same runner type; for a
  strict same-machine comparison, build base and head and bench both in one job.
- Write the baseline only from the main-branch job. A baseline rewritten on every passing run lets
  small regressions accumulate.

## Statistics that decide

- Collect many samples per variant (benchstat wants `-count` of 10 or more; criterion and JMH
  collect automatically). One number per side cannot be compared.
- Summarize with the median and a robust spread (MAD or interquartile range), not mean and
  standard deviation: timing distributions are right-skewed with outliers.
- Decide with a significance test or a confidence interval on the difference (Mann-Whitney U as
  benchstat does, or a bootstrap interval), and require a minimum effect size. Significant but
  under 2-5% is usually noise in the environment, not the code.
- Report: the statistic, the delta with its interval, the sample counts, the runner and the
  commit pair. "12% slower (95% CI 9-15%), n = 20 each, same runner, base abc123 vs head def456."

## Writing a benchmark that measures the code

- Warm up until the JIT tiers settle (JMH and BenchmarkDotNet do it; set `warmupTime` or
  `warmupIterations` elsewhere).
- Consume every result (`Blackhole`, `black_box`, `runtime.KeepAlive`, return the value) so the
  compiler cannot delete the work, and vary inputs enough that constant folding cannot apply.
- Do setup outside the timed loop (`b.ResetTimer()`, `@Setup`, `beforeEach` hooks, pytest-benchmark
  `pedantic` with a setup function).
- Benchmark the shape production sees: realistic sizes, realistic data distribution, cold and warm
  caches as separate benchmarks.
- Release or optimized builds only; no coverage, no debugger, no profiler attached.
- Name the benchmark after the operation and size (`dedupe/2000-distinct`), so a regression
  report says what changed.

## Running in CI

- Per change on a shared runner: instruction or allocation counts (iai-callgrind, Cachegrind,
  `AllocsPerRun`) are near-deterministic and can gate. Wall-clock benchmarks there can only warn.
- Per merge or nightly on a dedicated runner: run base and head back to back in the same job,
  alternating, and compare with the tool's statistics. Keep the history to spot slow drift that no
  single comparison flags.
- Store raw results as artifacts so a flagged regression can be re-analyzed without rerunning.
