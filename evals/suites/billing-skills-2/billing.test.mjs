// Unit tests for billing.mjs. Expected values are computed by hand from the documented rules
// (prices, seats, rates, grace and trial lengths), never by calling the code under test.

import { test } from "node:test";
import assert from "node:assert/strict";

import { convert, daysInMonth, invoice, monthlyPrice, prorate, status } from "./billing.mjs";

const DAY = 86_400_000;
const HOUR = 3_600_000;

/**
 * Run a function and describe how it ended, so refusal tables can list every offender at once.
 *
 * @param {() => unknown} run - The call to make.
 * @returns {string} "RangeError" when refused with a RangeError, otherwise a description of what happened.
 */
function outcome(run) {
	try {
		return `accepted: ${JSON.stringify(run())}`;
	} catch (error) {
		return error instanceof RangeError ? "RangeError" : `threw ${error?.constructor?.name}`;
	}
}

/**
 * Keep the rows whose actual value differs from the expected one.
 *
 * @param {Array<{ name: string, actual: unknown, expected: unknown }>} rows - Evaluated table rows.
 * @returns {Array<{ name: string, actual: unknown, expected: unknown }>} The offending rows.
 */
function mismatches(rows) {
	return rows.filter(function differs(row) {
		return JSON.stringify(row.actual) !== JSON.stringify(row.expected);
	});
}

/**
 * Build a UTC date from an ISO string.
 *
 * @param {string} iso - ISO 8601 timestamp.
 * @returns {Date} The date.
 */
function at(iso) {
	return new Date(iso);
}

test("daysInMonth counts the days of the UTC month, including leap Februaries", function daysInMonthTable() {
	const table = [
		{ name: "January", input: "2026-01-15T12:00:00Z", expected: 31 },
		{ name: "February, common year", input: "2026-02-10T00:00:00Z", expected: 28 },
		{ name: "February, leap year", input: "2024-02-29T23:59:59Z", expected: 29 },
		{ name: "February, century not leap", input: "1900-02-01T00:00:00Z", expected: 28 },
		{ name: "February, 400-year leap", input: "2000-02-01T00:00:00Z", expected: 29 },
		{ name: "April", input: "2026-04-30T23:59:59Z", expected: 30 },
		{ name: "December", input: "2026-12-01T00:00:00Z", expected: 31 },
		{ name: "late on Jan 31 in UTC-5 is Feb 1 UTC", input: "2026-01-31T22:00:00-05:00", expected: 28 },
	];
	const rows = table.map(function evaluate(row) {
		return { name: row.name, actual: daysInMonth(at(row.input)), expected: row.expected };
	});

	assert.deepEqual(mismatches(rows), []);
});

test("convert applies the rate and rounds half away from zero at the currency's minor units", function convertTable() {
	const table = [
		{ name: "USD is unchanged", usd: 1234, currency: "USD", expected: 1234 },
		{ name: "EUR at 0.92", usd: 1000, currency: "EUR", expected: 920 },
		{ name: "EUR 2.76 from 3.00", usd: 300, currency: "EUR", expected: 276 },
		{ name: "JPY has no minor units", usd: 1000, currency: "JPY", expected: 1495 },
		{ name: "JPY rounds 1.495 down to 1", usd: 1, currency: "JPY", expected: 1 },
		{ name: "JPY rounds 149.5 up to 150", usd: 100, currency: "JPY", expected: 150 },
		{ name: "JPY rounds -149.5 away from zero to -150", usd: -100, currency: "JPY", expected: -150 },
		{ name: "JPY rounds 2242.5 up to 2243", usd: 1500, currency: "JPY", expected: 2243 },
		{ name: "negative EUR", usd: -1000, currency: "EUR", expected: -920 },
		{ name: "zero", usd: 0, currency: "JPY", expected: 0 },
	];
	const rows = table.map(function evaluate(row) {
		return { name: row.name, actual: convert(row.usd, row.currency), expected: row.expected };
	});

	assert.deepEqual(mismatches(rows), []);
});

test("convert refuses currencies without a rate", function convertRefusals() {
	const offenders = ["GBP", "usd", "", undefined].filter(function accepted(currency) {
		return (
			outcome(function call() {
				return convert(1000, currency);
			}) !== "RangeError"
		);
	});

	assert.deepEqual(offenders, []);
	assert.throws(function call() {
		convert(1000, "GBP");
	}, /unsupported currency GBP/);
});

test("monthlyPrice charges the plan price plus 4.00 USD per seat beyond the included seats", function monthlyPriceTable() {
	const table = [
		{ plan: "free", seats: 1, expected: 0 },
		{ plan: "team", seats: 1, expected: 1500 },
		{ plan: "team", seats: 4, expected: 1500 },
		{ plan: "team", seats: 5, expected: 1500 },
		{ plan: "team", seats: 6, expected: 1900 },
		{ plan: "team", seats: 7, expected: 2300 },
		{ plan: "business", seats: 1, expected: 4900 },
		{ plan: "business", seats: 20, expected: 4900 },
		{ plan: "business", seats: 21, expected: 5300 },
		{ plan: "business", seats: 30, expected: 8900 },
	];
	const rows = table.map(function evaluate(row) {
		return { name: `${row.plan} x${row.seats}`, actual: monthlyPrice(row.plan, row.seats), expected: row.expected };
	});

	assert.deepEqual(mismatches(rows), []);
});

test("monthlyPrice refuses unknown plans, invalid seat counts and extra free seats", function monthlyPriceRefusals() {
	const table = [
		{ name: "unknown plan", plan: "gold", seats: 1 },
		{ name: "plan id with wrong case", plan: "Team", seats: 1 },
		{ name: "zero seats", plan: "team", seats: 0 },
		{ name: "negative seats", plan: "team", seats: -1 },
		{ name: "fractional seats", plan: "team", seats: 1.5 },
		{ name: "seats as string", plan: "team", seats: "2" },
		{ name: "NaN seats", plan: "team", seats: Number.NaN },
		{ name: "infinite seats", plan: "team", seats: Number.POSITIVE_INFINITY },
		{ name: "null seats", plan: "team", seats: null },
		{ name: "missing seats", plan: "team", seats: undefined },
		{ name: "two free seats", plan: "free", seats: 2 },
	];
	const offenders = table
		.map(function evaluate(row) {
			return {
				name: row.name,
				result: outcome(function call() {
					return monthlyPrice(row.plan, row.seats);
				}),
			};
		})
		.filter(function notRefused(row) {
			return row.result !== "RangeError";
		});

	assert.deepEqual(offenders, []);
	assert.throws(function call() {
		monthlyPrice("free", 2);
	}, /the free plan has one seat/);
});

test("invoice without a coupon bills one month, or ten months for a year", function invoiceNoCoupon() {
	const table = [
		{
			name: "team monthly",
			subscription: { plan: "team", seats: 6, interval: "month", currency: "USD" },
			expected: { subtotal: 1900, discount: 0, total: 1900, currency: "USD" },
		},
		{
			name: "team yearly",
			subscription: { plan: "team", seats: 5, interval: "year", currency: "USD" },
			expected: { subtotal: 15000, discount: 0, total: 15000, currency: "USD" },
		},
		{
			name: "business yearly, extra seat",
			subscription: { plan: "business", seats: 21, interval: "year", currency: "USD" },
			expected: { subtotal: 53000, discount: 0, total: 53000, currency: "USD" },
		},
		{
			name: "free monthly",
			subscription: { plan: "free", seats: 1, interval: "month", currency: "USD" },
			expected: { subtotal: 0, discount: 0, total: 0, currency: "USD" },
		},
		{
			name: "team monthly in EUR",
			subscription: { plan: "team", seats: 5, interval: "month", currency: "EUR" },
			expected: { subtotal: 1380, discount: 0, total: 1380, currency: "EUR" },
		},
		{
			name: "team monthly in JPY",
			subscription: { plan: "team", seats: 5, interval: "month", currency: "JPY" },
			expected: { subtotal: 2243, discount: 0, total: 2243, currency: "JPY" },
		},
	];
	const rows = table.map(function evaluate(row) {
		return { name: row.name, actual: invoice(row.subscription), expected: row.expected };
	});

	assert.deepEqual(mismatches(rows), []);
});

test("invoice applies percent and amount-off coupons in USD before converting", function invoiceCoupons() {
	const team = { plan: "team", seats: 5, interval: "month", currency: "USD" };
	const table = [
		{
			name: "20 percent",
			subscription: { ...team, coupon: { percent: 20 } },
			expected: { subtotal: 1500, discount: 300, total: 1200, currency: "USD" },
		},
		{
			name: "1 percent is allowed",
			subscription: { ...team, coupon: { percent: 1 } },
			expected: { subtotal: 1500, discount: 15, total: 1485, currency: "USD" },
		},
		{
			name: "half a percent is allowed, 7.5 rounds to 8",
			subscription: { ...team, coupon: { percent: 0.5 } },
			expected: { subtotal: 1500, discount: 8, total: 1492, currency: "USD" },
		},
		{
			name: "100 percent is allowed and zeroes the total",
			subscription: { ...team, coupon: { percent: 100 } },
			expected: { subtotal: 1500, discount: 1500, total: 0, currency: "USD" },
		},
		{
			name: "percent discount rounds 4999.5 up to 5000",
			subscription: { ...team, interval: "year", coupon: { percent: 33.33 } },
			expected: { subtotal: 15000, discount: 5000, total: 10000, currency: "USD" },
		},
		{
			name: "amount off",
			subscription: { ...team, coupon: { amountOff: 500 } },
			expected: { subtotal: 1500, discount: 500, total: 1000, currency: "USD" },
		},
		{
			name: "amount off is capped at the price",
			subscription: { ...team, coupon: { amountOff: 2000 } },
			expected: { subtotal: 1500, discount: 1500, total: 0, currency: "USD" },
		},
		{
			name: "percent wins over amount off",
			subscription: { ...team, coupon: { percent: 10, amountOff: 500 } },
			expected: { subtotal: 1500, discount: 150, total: 1350, currency: "USD" },
		},
		{
			name: "coupon with neither field discounts nothing",
			subscription: { ...team, coupon: {} },
			expected: { subtotal: 1500, discount: 0, total: 1500, currency: "USD" },
		},
		{
			name: "EUR discount converted from 3.00 USD",
			subscription: { ...team, currency: "EUR", coupon: { percent: 20 } },
			expected: { subtotal: 1380, discount: 276, total: 1104, currency: "EUR" },
		},
		{
			name: "JPY subtotal and discount round separately",
			subscription: { ...team, currency: "JPY", coupon: { amountOff: 100 } },
			expected: { subtotal: 2243, discount: 150, total: 2093, currency: "JPY" },
		},
	];
	const rows = table.map(function evaluate(row) {
		return { name: row.name, actual: invoice(row.subscription), expected: row.expected };
	});

	assert.deepEqual(mismatches(rows), []);
});

test("invoice applies a limited coupon only to periods before its month count", function invoiceCouponMonths() {
	const team = { plan: "team", seats: 5, interval: "month", currency: "USD" };
	const table = [
		{ name: "period omitted counts as the first", coupon: { percent: 20, months: 1 }, periodIndex: undefined, expected: 300 },
		{ name: "first period", coupon: { percent: 20, months: 3 }, periodIndex: 0, expected: 300 },
		{ name: "last covered period", coupon: { percent: 20, months: 3 }, periodIndex: 2, expected: 300 },
		{ name: "first period after expiry", coupon: { percent: 20, months: 3 }, periodIndex: 3, expected: 0 },
		{ name: "amount off expires too", coupon: { amountOff: 500, months: 1 }, periodIndex: 1, expected: 0 },
		{ name: "zero months never applies", coupon: { percent: 20, months: 0 }, periodIndex: 0, expected: 0 },
		{ name: "no month limit applies forever", coupon: { percent: 20 }, periodIndex: 120, expected: 300 },
	];
	const rows = table.map(function evaluate(row) {
		const result = invoice({ ...team, coupon: row.coupon, periodIndex: row.periodIndex });

		return { name: row.name, actual: [result.discount, result.total], expected: [row.expected, 1500 - row.expected] };
	});

	assert.deepEqual(mismatches(rows), []);
});

test("invoice refuses percent coupons outside (0, 100] and invalid plans or currencies", function invoiceRefusals() {
	const team = { plan: "team", seats: 5, interval: "month", currency: "USD" };
	const table = [
		{ name: "zero percent", subscription: { ...team, coupon: { percent: 0 } } },
		{ name: "negative percent", subscription: { ...team, coupon: { percent: -5 } } },
		{ name: "just over 100 percent", subscription: { ...team, coupon: { percent: 100.01 } } },
		{ name: "unknown plan", subscription: { ...team, plan: "gold" } },
		{ name: "invalid seats", subscription: { ...team, seats: 0 } },
		{ name: "unsupported currency", subscription: { ...team, currency: "GBP" } },
	];
	const offenders = table
		.map(function evaluate(row) {
			return {
				name: row.name,
				result: outcome(function call() {
					return invoice(row.subscription);
				}),
			};
		})
		.filter(function notRefused(row) {
			return row.result !== "RangeError";
		});

	assert.deepEqual(offenders, []);
	assert.throws(function call() {
		invoice({ ...team, coupon: { percent: 101 } });
	}, /percent must be in \(0, 100\]/);
});

test("prorate charges or credits the price difference for the remaining days, day of change included", function prorateTable() {
	const table = [
		{ name: "upgrade on the 1st of a 30-day month: full difference", from: 1500, to: 1900, changedAt: "2026-04-01T09:00:00Z", expected: 400 },
		{ name: "upgrade on the 16th of 30: half", from: 1500, to: 1900, changedAt: "2026-04-16T00:00:00Z", expected: 200 },
		{ name: "upgrade on the last day: one day, 13.33 rounds to 13", from: 1500, to: 1900, changedAt: "2026-04-30T23:59:59Z", expected: 13 },
		{ name: "downgrade is a credit", from: 1900, to: 1500, changedAt: "2026-04-16T00:00:00Z", expected: -200 },
		{ name: "same price is zero", from: 1500, to: 1500, changedAt: "2026-04-16T00:00:00Z", expected: 0 },
		{ name: "leap February: 15 of 29 days, 206.9 rounds to 207", from: 1500, to: 1900, changedAt: "2024-02-15T00:00:00Z", expected: 207 },
		{ name: "common February: 14 of 28 days", from: 1500, to: 1900, changedAt: "2026-02-15T00:00:00Z", expected: 200 },
		{ name: "31-day month: 10 of 31 days, 129.03 rounds to 129", from: 1500, to: 1900, changedAt: "2026-01-22T00:00:00Z", expected: 129 },
		{ name: "half cent charge rounds up: 7 of 28 days of 2", from: 0, to: 2, changedAt: "2026-02-22T00:00:00Z", expected: 1 },
		{ name: "half cent credit rounds away from zero", from: 2, to: 0, changedAt: "2026-02-22T00:00:00Z", expected: -1 },
		{
			name: "uses the UTC day: 1 May at 00:30 +02:00 is 30 April UTC",
			from: 1500,
			to: 1900,
			changedAt: "2026-05-01T00:30:00+02:00",
			expected: 13,
		},
	];
	const rows = table.map(function evaluate(row) {
		return {
			name: row.name,
			actual: prorate({ fromMonthly: row.from, toMonthly: row.to, changedAt: at(row.changedAt) }),
			expected: row.expected,
		};
	});

	assert.deepEqual(mismatches(rows), []);
});

test("status follows canceled, then unpaid, then trial, then active", function statusTable() {
	const start = at("2026-03-01T00:00:00Z");
	const periodEnd = at("2026-04-01T00:00:00Z");
	const unpaidSince = at("2026-03-20T00:00:00Z");
	const team = { plan: "team", startedAt: start, periodEnd };
	const table = [
		{ name: "paid plan on day one is trialing", subscription: team, now: start, expected: "trialing" },
		{
			name: "paid plan 1 ms before 14 days is trialing",
			subscription: team,
			now: new Date(start.getTime() + 14 * DAY - 1),
			expected: "trialing",
		},
		{ name: "paid plan at exactly 14 days is active", subscription: team, now: new Date(start.getTime() + 14 * DAY), expected: "active" },
		{ name: "free plan never trials", subscription: { ...team, plan: "free" }, now: start, expected: "active" },
		{
			name: "unpaid for 6 days 23 hours is past due",
			subscription: { ...team, unpaidSince },
			now: new Date(unpaidSince.getTime() + 7 * DAY - HOUR),
			expected: "past_due",
		},
		{ name: "unpaid since this instant is past due", subscription: { ...team, unpaidSince }, now: unpaidSince, expected: "past_due" },
		{
			name: "unpaid for exactly 7 days is suspended",
			subscription: { ...team, unpaidSince },
			now: new Date(unpaidSince.getTime() + 7 * DAY),
			expected: "suspended",
		},
		{
			name: "unpaid during the trial is past due, not trialing",
			subscription: { ...team, unpaidSince: start },
			now: new Date(start.getTime() + DAY),
			expected: "past_due",
		},
		{
			name: "canceled before period end keeps running",
			subscription: { ...team, canceledAt: at("2026-03-25T00:00:00Z") },
			now: at("2026-03-31T23:59:59Z"),
			expected: "active",
		},
		{
			name: "canceled during the trial still trials until period end",
			subscription: { ...team, canceledAt: at("2026-03-02T00:00:00Z") },
			now: at("2026-03-03T00:00:00Z"),
			expected: "trialing",
		},
		{
			name: "canceled at exactly period end",
			subscription: { ...team, canceledAt: at("2026-03-25T00:00:00Z") },
			now: periodEnd,
			expected: "canceled",
		},
		{
			name: "canceled wins over suspended",
			subscription: { ...team, canceledAt: at("2026-03-25T00:00:00Z"), unpaidSince },
			now: at("2026-05-01T00:00:00Z"),
			expected: "canceled",
		},
		{ name: "period end without cancellation stays active", subscription: team, now: at("2026-05-01T00:00:00Z"), expected: "active" },
	];
	const rows = table.map(function evaluate(row) {
		return { name: row.name, actual: status(row.subscription, row.now), expected: row.expected };
	});

	assert.deepEqual(mismatches(rows), []);
});
