// A scaling-ratio measurement that tolerates a noisy, shared machine: it compares the time of the
// same operation at n and at factor * n on the same machine in the same process, so CPU speed,
// load and timer resolution cancel out. Used by `test/performance-examples.test.ts` and by
// `measure.mjs`.

import { performance } from "node:perf_hooks";

/**
 * Median of a list of numbers.
 *
 * @param {readonly number[]} values - At least one number.
 * @returns {number} The middle value, or the mean of the two middle values.
 * @throws {RangeError} When the list is empty.
 */
export function median(values) {
	if (values.length === 0) throw new RangeError("median of an empty list");

	const sorted = [...values].sort(function ascending(a, b) {
		return a - b;
	});
	const middle = Math.floor(sorted.length / 2);

	return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Wall time of running an operation several times in a row.
 *
 * @template T
 * @param {(input: T) => unknown} operation - Code under measurement.
 * @param {T} input - Input passed to every call.
 * @param {number} reps - Calls per sample.
 * @returns {number} Elapsed milliseconds for all calls.
 */
export function timeReps(operation, input, reps) {
	let sink = 0;
	const start = performance.now();

	for (let rep = 0; rep < reps; rep += 1) {
		// Keep a dependency on the result so the call cannot be optimized away.
		if (operation(input) !== undefined) sink += 1;
	}

	const elapsed = performance.now() - start;

	if (sink < 0) throw new Error("unreachable");

	return elapsed;
}

/**
 * @typedef {object} ScalingOptions
 * @property {number} size - The small input size n.
 * @property {number} [factor] - The large input is factor * n. Defaults to 8.
 * @property {number} [samples] - Samples per size, interleaved small then large. Defaults to 15.
 * @property {number} [minSampleMs] - Calibrate calls per sample until the small sample takes this long. Defaults to 0.2.
 * @property {number} [warmup] - Untimed calls per size before measuring, so the code is optimized. Defaults to 3.
 */

/**
 * @typedef {object} ScalingResult
 * @property {number} ratio - Fastest large sample divided by fastest small sample. Machine noise only
 *   ever adds time, so the fastest sample is the estimate least disturbed by it.
 * @property {number} medianRatio - Median large sample divided by median small sample, for comparison.
 * @property {number} smallMs - Fastest milliseconds of one sample at n.
 * @property {number} largeMs - Fastest milliseconds of one sample at factor * n.
 * @property {number} smallMedianMs - Median milliseconds of one sample at n, what an absolute budget would check.
 * @property {number} reps - Calls per sample, the same at both sizes.
 */

/**
 * Measure how an operation's time grows when its input grows by a factor.
 *
 * Expected ratios for factor 8: about 8 for O(n), about 9 to 11 for O(n log n), about 64 for
 * O(n^2). Absolute times are reported for information only; assert on the ratio.
 *
 * @template T
 * @param {(input: T) => unknown} operation - Code under measurement.
 * @param {(size: number) => T} makeInput - Builds an input of a given size, outside the timed region.
 * @param {ScalingOptions} options - Sizes and sampling.
 * @returns {ScalingResult} The ratio and the samples behind it.
 */
export function measureScaling(operation, makeInput, options) {
	const factor = options.factor ?? 8;
	const samples = options.samples ?? 15;
	const minSampleMs = options.minSampleMs ?? 0.2;
	const warmup = options.warmup ?? 3;
	const small = makeInput(options.size);
	const large = makeInput(options.size * factor);

	timeReps(operation, small, warmup);
	timeReps(operation, large, warmup);

	let reps = 1;

	while (timeReps(operation, small, reps) < minSampleMs && reps < 1 << 20) reps *= 2;

	/** @type {number[]} */
	const smallTimes = [];
	/** @type {number[]} */
	const largeTimes = [];

	for (let sample = 0; sample < samples; sample += 1) {
		// Interleave sizes so a burst of machine noise lands on both, not on one.
		smallTimes.push(timeReps(operation, small, reps));
		largeTimes.push(timeReps(operation, large, reps));
	}

	const smallMs = Math.min(...smallTimes);
	const largeMs = Math.min(...largeTimes);

	return {
		ratio: largeMs / smallMs,
		medianRatio: median(largeTimes) / median(smallTimes),
		smallMs,
		largeMs,
		smallMedianMs: median(smallTimes),
		reps,
	};
}
