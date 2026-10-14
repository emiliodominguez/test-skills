// Benchmark of the keyed dedupe against a stored baseline, backing the Vitest bench claims in
// `test-performance`. Benchmarks run only with `vitest bench`; the default `vitest run` include
// (test/**/*.test.ts) never picks this file up.
//
// Store a baseline of the fixed dedupe, then compare (out/ is ignored by git):
//   WRITE_BASELINE=1 npx vitest bench --run examples/performance/dedupe.bench.ts
//   npx vitest bench --run examples/performance/dedupe.bench.ts
// Seed the regression against the same baseline; the gate must fail:
//   BENCH_VARIANT=buggy npx vitest bench --run examples/performance/dedupe.bench.ts
import { existsSync } from "node:fs";
import { expect, test } from "vitest";
import { dedupeBy } from "./modules.mjs";

type Item = { sku: string };

/** Stored baseline, written only on request or when absent. */
const BASELINE = "out/bench/dedupe.json";

/**
 * Largest allowed ratio of head p50 latency to baseline p50 latency, set above the largest ratio
 * seen in 20 runs of unchanged code against its own baseline on the enforcing machine. Observed on
 * a 4-core machine, not asserted elsewhere: at most 1.08 in 20 runs alone and 1.04 in 12 runs with
 * four concurrent copies; the seeded quadratic dedupe read about 67. Recalibrate per runner type.
 */
const P50_RATIO_LIMIT = 1.25;

/** Mean regression that is reported as a warning only: the mean moves with machine noise. */
const MEAN_WARNING_DELTA = 0.1;

/** Variant under measurement: the fix by default, the quadratic regression on request. */
const fixed = process.env.BENCH_VARIANT !== "buggy";

const items: Item[] = Array.from({ length: 2000 }, function item(_, index) {
	return { sku: `sku-${index % 1500}` };
});

/**
 * Key of an item.
 *
 * @param item - An item.
 * @returns Its SKU.
 */
function skuOf(item: Item): string {
	return item.sku;
}

/**
 * The operation under measurement.
 *
 * @returns The deduplicated items, returned so the harness consumes them.
 */
function run(): Item[] {
	return dedupeBy(items, skuOf, { fixed });
}

test("dedupe p50 stays within the calibrated ratio of the stored baseline", async function againstBaseline({ bench }) {
	const options = { time: 500, warmupTime: 100 };

	if (process.env.WRITE_BASELINE || !existsSync(BASELINE)) {
		await bench("dedupe", { writeResult: BASELINE }, run).run(options);

		return;
	}

	const result = await bench.compare(bench.from("baseline", BASELINE), bench("dedupe", run), options);
	const head = result.get("dedupe").latency;
	const base = result.get("baseline").latency;
	const p50Ratio = head.p50 / base.p50;
	const meanDelta = head.mean / base.mean - 1;

	console.log(`p50 ratio ${p50Ratio.toFixed(3)}, mean delta ${(meanDelta * 100).toFixed(1)}%`);

	if (meanDelta > MEAN_WARNING_DELTA) {
		console.warn(`warning only: mean ${(meanDelta * 100).toFixed(1)}% slower than the baseline; rerun before acting`);
	}

	expect(p50Ratio, `p50 ratio ${p50Ratio.toFixed(3)}`).toBeLessThanOrEqual(P50_RATIO_LIMIT);
});
