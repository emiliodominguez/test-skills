// Unit tests for billing.mjs. Expected amounts are worked out by hand from the documented rules
// (prices, seat price, annual months, rates, rounding half away from zero), never by calling the
// code under test.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { convert, daysInMonth, invoice, monthlyPrice, prorate, status } from "./billing.mjs";

const DAY = 86_400_000;

/**
 * Build a UTC date.
 *
 * @param {string} iso - ISO 8601 timestamp.
 * @returns {Date} The date.
 */
function at(iso) {
	return new Date(iso);
}

/**
 * Run a table of cases and return the ones whose actual result differs from the expected one.
 *
 * @template I, O
 * @param {Array<{ input: I, expected: O }>} cases - Inputs with expected outputs.
 * @param {(input: I) => O} run - Function that computes the actual output.
 * @returns {Array<{ input: I, expected: O, actual: O }>} Offending cases.
 */
function offenders(cases, run) {
	return cases
		.map(function evaluate(entry) {
			return { input: entry.input, expected: entry.expected, actual: run(entry.input) };
		})
		.filter(function differs(entry) {
			return JSON.stringify(entry.actual) !== JSON.stringify(entry.expected);
		});
}

/**
 * Return the inputs for which a call does not throw a RangeError.
 *
 * @template I
 * @param {I[]} inputs - Inputs that must be refused.
 * @param {(input: I) => unknown} run - Function under test.
 * @returns {I[]} Inputs that were accepted or failed with another error type.
 */
function notRefused(inputs, run) {
	return inputs.filter(function accepted(input) {
		try {
			run(input);
			return true;
		} catch (error) {
			return !(error instanceof RangeError);
		}
	});
}

describe("daysInMonth", function suite() {
	test("returns the calendar length of the UTC month, including leap years", function check() {
		const cases = [
			{ input: "2026-01-15T00:00:00Z", expected: 31 },
			{ input: "2026-02-01T00:00:00Z", expected: 28 },
			{ input: "2024-02-29T12:00:00Z", expected: 29 },
			{ input: "2100-02-10T00:00:00Z", expected: 28 },
			{ input: "2000-02-10T00:00:00Z", expected: 29 },
			{ input: "2026-04-30T23:59:59Z", expected: 30 },
			{ input: "2026-12-31T23:59:59Z", expected: 31 },
		];

		assert.deepEqual(
			offenders(cases, function run(iso) {
				return daysInMonth(at(iso));
			}),
			[],
		);
	});

	test("uses the UTC month, not the local one", function check() {
		// 2026-04-30 23:00 at UTC-05:00 is already 1 May in UTC (31 days).
		assert.equal(daysInMonth(at("2026-04-30T23:00:00-05:00")), 31);
	});
});

describe("convert", function suite() {
	test("converts USD cents with the rate and the target's minor units", function check() {
		const cases = [
			{ input: [1234, "USD"], expected: 1234 },
			{ input: [0, "EUR"], expected: 0 },
			{ input: [1000, "EUR"], expected: 920 }, // 10.00 * 0.92 = 9.20
			{ input: [15000, "EUR"], expected: 13800 }, // 150 * 0.92 = 138.00
			{ input: [7, "EUR"], expected: 6 }, // 6.44 cents rounds down
			{ input: [3, "EUR"], expected: 3 }, // 2.76 cents rounds up
			{ input: [1500, "JPY"], expected: 2243 }, // 15 * 149.5 = 2242.5 yen, no minor units
			{ input: [200, "JPY"], expected: 299 }, // 2 * 149.5 = 299 yen exactly
		];

		assert.deepEqual(
			offenders(cases, function run(input) {
				return convert(input[0], input[1]);
			}),
			[],
		);
	});

	test("rounds exact halves away from zero in both directions", function check() {
		// 1.00 USD = 149.5 JPY exactly: Math.round alone would give 150 and -149.
		assert.deepEqual([convert(100, "JPY"), convert(-100, "JPY")], [150, -150]);
	});

	test("keeps the sign of negative amounts", function check() {
		assert.deepEqual([convert(-1000, "EUR"), convert(-7, "EUR"), convert(-1234, "USD")], [-920, -6, -1234]);
	});

	test("refuses currencies without a rate", function check() {
		assert.throws(
			function run() {
				convert(100, "GBP");
			},
			{ name: "RangeError", message: "unsupported currency GBP" },
		);
		assert.deepEqual(
			notRefused(["", "usd", "EURO", undefined], function run(currency) {
				return convert(100, currency);
			}),
			[],
		);
	});
});

describe("monthlyPrice", function suite() {
	test("charges the plan price plus 4.00 USD per seat beyond the included seats", function check() {
		const cases = [
			{ input: ["free", 1], expected: 0 },
			{ input: ["team", 1], expected: 1500 },
			{ input: ["team", 5], expected: 1500 },
			{ input: ["team", 6], expected: 1900 },
			{ input: ["team", 12], expected: 1500 + 7 * 400 },
			{ input: ["business", 19], expected: 4900 },
			{ input: ["business", 20], expected: 4900 },
			{ input: ["business", 21], expected: 5300 },
			{ input: ["business", 23], expected: 6100 },
		];

		assert.deepEqual(
			offenders(cases, function run(input) {
				return monthlyPrice(input[0], input[1]);
			}),
			[],
		);
	});

	test("refuses an unknown plan", function check() {
		assert.throws(
			function run() {
				monthlyPrice("enterprise", 1);
			},
			{ name: "RangeError", message: "unknown plan enterprise" },
		);
	});

	test("refuses seat counts that are not positive integers", function check() {
		const invalid = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "3", null, undefined];

		assert.deepEqual(
			notRefused(invalid, function run(seats) {
				return monthlyPrice("team", seats);
			}),
			[],
		);
		assert.throws(
			function run() {
				monthlyPrice("team", 0);
			},
			{ name: "RangeError", message: "seats must be a positive integer" },
		);
	});

	test("refuses more than one seat on the free plan", function check() {
		assert.throws(
			function run() {
				monthlyPrice("free", 2);
			},
			{ name: "RangeError", message: "the free plan has one seat" },
		);
	});
});

describe("invoice", function suite() {
	test("bills a month at the monthly price and a year at ten months", function check() {
		const cases = [
			{
				input: { plan: "team", seats: 5, interval: "month", currency: "USD" },
				expected: { subtotal: 1500, discount: 0, total: 1500, currency: "USD" },
			},
			{
				input: { plan: "team", seats: 6, interval: "year", currency: "USD" },
				expected: { subtotal: 19000, discount: 0, total: 19000, currency: "USD" },
			},
			{
				input: { plan: "free", seats: 1, interval: "year", currency: "EUR" },
				expected: { subtotal: 0, discount: 0, total: 0, currency: "EUR" },
			},
		];

		assert.deepEqual(offenders(cases, invoice), []);
	});

	test("applies a percent coupon to the USD amount before converting", function check() {
		const cases = [
			{
				// 1500 * 20% = 300.
				input: { plan: "team", seats: 5, interval: "month", currency: "USD", coupon: { percent: 20 } },
				expected: { subtotal: 1500, discount: 300, total: 1200, currency: "USD" },
			},
			{
				// 15000 USD cents -> 13800 EUR cents; 20% = 3000 USD cents -> 2760 EUR cents.
				input: { plan: "team", seats: 5, interval: "year", currency: "EUR", coupon: { percent: 20 } },
				expected: { subtotal: 13800, discount: 2760, total: 11040, currency: "EUR" },
			},
			{
				// 100% is allowed and leaves nothing to pay.
				input: { plan: "business", seats: 20, interval: "month", currency: "USD", coupon: { percent: 100 } },
				expected: { subtotal: 4900, discount: 4900, total: 0, currency: "USD" },
			},
			{
				// 1500 * 0.1% = 1.5 cents, rounded to 2.
				input: { plan: "team", seats: 5, interval: "month", currency: "USD", coupon: { percent: 0.1 } },
				expected: { subtotal: 1500, discount: 2, total: 1498, currency: "USD" },
			},
		];

		assert.deepEqual(offenders(cases, invoice), []);
	});

	test("applies an amount-off coupon capped at the amount due", function check() {
		const cases = [
			{
				input: { plan: "team", seats: 5, interval: "month", currency: "USD", coupon: { amountOff: 500 } },
				expected: { subtotal: 1500, discount: 500, total: 1000, currency: "USD" },
			},
			{
				input: { plan: "team", seats: 5, interval: "month", currency: "USD", coupon: { amountOff: 1500 } },
				expected: { subtotal: 1500, discount: 1500, total: 0, currency: "USD" },
			},
			{
				input: { plan: "team", seats: 5, interval: "month", currency: "USD", coupon: { amountOff: 99999 } },
				expected: { subtotal: 1500, discount: 1500, total: 0, currency: "USD" },
			},
			{
				// 1.00 USD off in JPY: 149.5 yen rounds to 150.
				input: { plan: "team", seats: 5, interval: "month", currency: "JPY", coupon: { amountOff: 100 } },
				expected: { subtotal: 2243, discount: 150, total: 2093, currency: "JPY" },
			},
		];

		assert.deepEqual(offenders(cases, invoice), []);
	});

	test("uses the percent and ignores amountOff when a coupon has both", function check() {
		const result = invoice({ plan: "team", seats: 5, interval: "month", currency: "USD", coupon: { percent: 10, amountOff: 1000 } });

		assert.deepEqual(result, { subtotal: 1500, discount: 150, total: 1350, currency: "USD" });
	});

	test("applies a limited coupon only to periods before its month count", function check() {
		const coupon = { percent: 50, months: 3 };
		const discounts = [0, 1, 2, 3, 4].map(function discountFor(periodIndex) {
			return invoice({ plan: "team", seats: 5, interval: "month", currency: "USD", coupon, periodIndex }).discount;
		});

		assert.deepEqual(discounts, [750, 750, 750, 0, 0]);
	});

	test("treats a missing period index as the first period", function check() {
		const limited = invoice({ plan: "team", seats: 5, interval: "month", currency: "USD", coupon: { amountOff: 200, months: 1 } });
		const none = invoice({ plan: "team", seats: 5, interval: "month", currency: "USD", coupon: { amountOff: 200, months: 0 } });

		assert.deepEqual([limited.discount, none.discount], [200, 0]);
	});

	test("applies a coupon without a month count forever", function check() {
		const result = invoice({ plan: "team", seats: 5, interval: "month", currency: "USD", coupon: { amountOff: 200 }, periodIndex: 120 });

		assert.equal(result.discount, 200);
	});

	test("refuses a percent outside (0, 100] on an active coupon", function check() {
		const invalid = [0, -5, 100.01, 150];

		assert.deepEqual(
			notRefused(invalid, function run(percent) {
				return invoice({ plan: "team", seats: 5, interval: "month", currency: "USD", coupon: { percent } });
			}),
			[],
		);
		assert.throws(
			function run() {
				invoice({ plan: "team", seats: 5, interval: "month", currency: "USD", coupon: { percent: 0 } });
			},
			{ name: "RangeError", message: "percent must be in (0, 100]" },
		);
	});

	test("does not validate the percent of an expired coupon", function check() {
		const result = invoice({ plan: "team", seats: 5, interval: "month", currency: "USD", coupon: { percent: 0, months: 1 }, periodIndex: 1 });

		assert.deepEqual(result, { subtotal: 1500, discount: 0, total: 1500, currency: "USD" });
	});

	test("propagates refusals from the plan, the seats and the currency", function check() {
		const invalid = [
			{ plan: "enterprise", seats: 1, interval: "month", currency: "USD" },
			{ plan: "team", seats: 0, interval: "month", currency: "USD" },
			{ plan: "free", seats: 2, interval: "month", currency: "USD" },
			{ plan: "team", seats: 5, interval: "month", currency: "GBP" },
		];

		assert.deepEqual(notRefused(invalid, invoice), []);
	});
});

describe("prorate", function suite() {
	test("charges or credits the price difference for the remaining days, the change day included", function check() {
		const cases = [
			// April 2026 has 30 days.
			{ input: { fromMonthly: 1500, toMonthly: 1900, changedAt: "2026-04-01T09:00:00Z" }, expected: 400 },
			{ input: { fromMonthly: 1500, toMonthly: 1900, changedAt: "2026-04-16T09:00:00Z" }, expected: 200 }, // 400 * 15 / 30
			{ input: { fromMonthly: 1900, toMonthly: 1500, changedAt: "2026-04-16T09:00:00Z" }, expected: -200 },
			{ input: { fromMonthly: 1500, toMonthly: 1900, changedAt: "2026-04-30T09:00:00Z" }, expected: 13 }, // 400 / 30 = 13.33
			{ input: { fromMonthly: 1500, toMonthly: 1900, changedAt: "2026-04-28T09:00:00Z" }, expected: 40 }, // 400 * 3 / 30
			{ input: { fromMonthly: 1500, toMonthly: 1500, changedAt: "2026-04-16T09:00:00Z" }, expected: 0 },
			// February 2024 has 29 days: 400 * 15 / 29 = 206.9.
			{ input: { fromMonthly: 1500, toMonthly: 1900, changedAt: "2024-02-15T00:00:00Z" }, expected: 207 },
			// January has 31 days: 3400 * 11 / 31 = 1206.45.
			{ input: { fromMonthly: 1500, toMonthly: 4900, changedAt: "2026-01-21T00:00:00Z" }, expected: 1206 },
		];

		assert.deepEqual(
			offenders(cases, function run(input) {
				return prorate({ fromMonthly: input.fromMonthly, toMonthly: input.toMonthly, changedAt: at(input.changedAt) });
			}),
			[],
		);
	});

	test("rounds exact halves away from zero for charges and credits", function check() {
		// February 2026 has 28 days; from the 15th, 14 days remain: 1 * 14 / 28 = 0.5.
		const changedAt = at("2026-02-15T00:00:00Z");

		assert.deepEqual([prorate({ fromMonthly: 0, toMonthly: 1, changedAt }), prorate({ fromMonthly: 1, toMonthly: 0, changedAt })], [1, -1]);
	});

	test("counts days in UTC", function check() {
		// 30 April 23:30 at UTC-05:00 is 1 May 04:30 UTC: the whole of May remains.
		assert.equal(prorate({ fromMonthly: 1500, toMonthly: 1900, changedAt: at("2026-04-30T23:30:00-05:00") }), 400);
	});
});

describe("status", function suite() {
	const startedAt = at("2026-03-01T00:00:00Z");
	const periodEnd = at("2026-04-01T00:00:00Z");

	test("is trialing for paid plans during the first 14 days, then active", function check() {
		const cases = [
			{ input: { plan: "team", now: startedAt.getTime() }, expected: "trialing" },
			{ input: { plan: "team", now: startedAt.getTime() + 14 * DAY - 1 }, expected: "trialing" },
			{ input: { plan: "business", now: startedAt.getTime() + 13 * DAY }, expected: "trialing" },
			{ input: { plan: "team", now: startedAt.getTime() + 14 * DAY }, expected: "active" },
			{ input: { plan: "team", now: startedAt.getTime() + 20 * DAY }, expected: "active" },
		];

		assert.deepEqual(
			offenders(cases, function run(input) {
				return status({ plan: input.plan, startedAt, periodEnd }, new Date(input.now));
			}),
			[],
		);
	});

	test("never trials the free plan", function check() {
		assert.equal(status({ plan: "free", startedAt, periodEnd }, startedAt), "active");
	});

	test("is past due before 7 unpaid days and suspended from the 7th", function check() {
		const unpaidSince = at("2026-03-20T00:00:00Z");
		const cases = [
			{ input: unpaidSince.getTime(), expected: "past_due" },
			{ input: unpaidSince.getTime() + 7 * DAY - 1, expected: "past_due" },
			{ input: unpaidSince.getTime() + 7 * DAY, expected: "suspended" },
			{ input: unpaidSince.getTime() + 30 * DAY, expected: "suspended" },
		];

		assert.deepEqual(
			offenders(cases, function run(now) {
				return status({ plan: "team", startedAt, periodEnd: at("2026-06-01T00:00:00Z"), unpaidSince }, new Date(now));
			}),
			[],
		);
	});

	test("reports an unpaid trial as past due rather than trialing", function check() {
		const unpaidSince = at("2026-03-02T00:00:00Z");

		assert.equal(status({ plan: "team", startedAt, periodEnd, unpaidSince }, at("2026-03-03T00:00:00Z")), "past_due");
	});

	test("is canceled from the period end of a canceled subscription, and not before", function check() {
		const canceledAt = at("2026-03-25T00:00:00Z");
		const cases = [
			{ input: periodEnd.getTime() - 1, expected: "active" },
			{ input: periodEnd.getTime(), expected: "canceled" },
			{ input: periodEnd.getTime() + 10 * DAY, expected: "canceled" },
		];

		assert.deepEqual(
			offenders(cases, function run(now) {
				return status({ plan: "team", startedAt, periodEnd, canceledAt }, new Date(now));
			}),
			[],
		);
	});

	test("reports canceled over suspended once the period has ended", function check() {
		const subscription = { plan: "team", startedAt, periodEnd, canceledAt: at("2026-03-10T00:00:00Z"), unpaidSince: at("2026-03-05T00:00:00Z") };

		assert.deepEqual([status(subscription, at("2026-03-31T00:00:00Z")), status(subscription, periodEnd)], ["suspended", "canceled"]);
	});

	test("ignores the period end of a subscription that was not canceled", function check() {
		assert.equal(status({ plan: "team", startedAt, periodEnd }, at("2026-05-01T00:00:00Z")), "active");
	});
});
