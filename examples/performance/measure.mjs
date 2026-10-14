#!/usr/bin/env node
// Measure the dedupe regression repeatedly and show why the test asserts a scaling ratio of the
// fastest samples rather than an absolute time or a ratio of medians. Prints, for the buggy and
// the fixed dedupe, the spread across rounds of the median time per call at n (what an absolute
// budget checks) and of the n -> 8n ratio from fastest and from median samples, with how many
// rounds each ratio would misclassify. Run it alone, then several copies at once to add contention:
//
//   node examples/performance/measure.mjs --rounds 20
//   for i in 1 2 3 4; do node examples/performance/measure.mjs --rounds 20 & done; wait

import { dedupeBy } from "./modules.mjs";
import { measureScaling } from "./scaling.mjs";

/** Ratio threshold used by the test: three times the linear expectation, under half the quadratic one. */
const RATIO_THRESHOLD = 24;

/**
 * Items with distinct keys, the worst case for a rescanning dedupe.
 *
 * @param {number} size - Number of items.
 * @returns {Array<{ sku: string }>} Items.
 */
function makeItems(size) {
	return Array.from({ length: size }, function item(_, index) {
		return { sku: `sku-${index}` };
	});
}

/**
 * Key of an item.
 *
 * @param {{ sku: string }} item - An item.
 * @returns {string} Its SKU.
 */
function skuOf(item) {
	return item.sku;
}

/**
 * Value of a numeric command-line option.
 *
 * @param {string} name - Option name, such as `--rounds`.
 * @param {number} fallback - Value when the option is absent.
 * @returns {number} The parsed value.
 */
function numberOption(name, fallback) {
	const index = process.argv.indexOf(name);

	return index === -1 ? fallback : Number(process.argv[index + 1]);
}

/**
 * Summary of a list of numbers.
 *
 * @param {readonly number[]} values - Measurements.
 * @returns {string} Minimum, maximum and max/min spread.
 */
function spread(values) {
	const min = Math.min(...values);
	const max = Math.max(...values);

	return `min ${min.toFixed(3)}  max ${max.toFixed(3)}  max/min ${(max / min).toFixed(2)}`;
}

/**
 * Measure one variant for several rounds and print the comparison.
 *
 * @param {string} label - Variant name.
 * @param {boolean} fixed - Whether to measure the fixed dedupe.
 * @param {number} rounds - Number of independent measurements.
 */
function report(label, fixed, rounds) {
	/** @type {number[]} */
	const ratios = [];
	/** @type {number[]} */
	const medianRatios = [];
	/** @type {number[]} */
	const perCallMs = [];
	/** @type {number[]} */
	const perCallMedianMs = [];

	for (let round = 0; round < rounds; round += 1) {
		const result = measureScaling(
			function run(items) {
				return dedupeBy(items, skuOf, { fixed });
			},
			makeItems,
			{ size: SIZE },
		);

		ratios.push(result.ratio);
		medianRatios.push(result.medianRatio);
		perCallMs.push(result.smallMs / result.reps);
		perCallMedianMs.push(result.smallMedianMs / result.reps);
	}

	/**
	 * Rounds whose ratio would classify this variant wrongly.
	 *
	 * @param {readonly number[]} values - Ratios.
	 * @returns {number} Count on the wrong side of the threshold.
	 */
	function wrongSide(values) {
		return values.filter(function misclassified(ratio) {
			return fixed ? ratio >= RATIO_THRESHOLD : ratio <= RATIO_THRESHOLD;
		}).length;
	}

	console.log(`${label}`);
	console.log(`  ms per call at n=${SIZE} (fastest sample): ${spread(perCallMs)}`);
	console.log(`  ms per call at n=${SIZE} (median sample):  ${spread(perCallMedianMs)}`);
	console.log(`  ratio 8n/n (fastest samples): ${spread(ratios)}; wrong side of ${RATIO_THRESHOLD}: ${wrongSide(ratios)}/${rounds}`);
	console.log(`  ratio 8n/n (median samples):  ${spread(medianRatios)}; wrong side of ${RATIO_THRESHOLD}: ${wrongSide(medianRatios)}/${rounds}`);
}

/** Size n, 200 by default as in the test; the large input is 8n. */
const SIZE = numberOption("--size", 200);
const rounds = numberOption("--rounds", 20);

report("buggy (quadratic)", false, rounds);
report("fixed (linear)", true, rounds);
