import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
	MINOR_UNITS,
	PLANS,
	EXTRA_SEAT,
	ANNUAL_MONTHS_CHARGED,
	RATES,
	GRACE_DAYS,
	TRIAL_DAYS,
	daysInMonth,
	convert,
	monthlyPrice,
	invoice,
	prorate,
	status,
} from "./billing.mjs";

const DAY = 86_400_000;
const d = (s) => new Date(s);

describe("constants", () => {
	test("have the documented values", () => {
		assert.deepEqual(MINOR_UNITS, { USD: 2, EUR: 2, JPY: 0 });
		assert.deepEqual(PLANS.team, { monthly: 1500, seats: 5 });
		assert.equal(EXTRA_SEAT, 400);
		assert.equal(ANNUAL_MONTHS_CHARGED, 10);
		assert.deepEqual(RATES, { USD: 1, EUR: 0.92, JPY: 149.5 });
		assert.equal(GRACE_DAYS, 7);
		assert.equal(TRIAL_DAYS, 14);
	});
});

describe("daysInMonth", () => {
	test("handles month lengths and leap years", () => {
		assert.equal(daysInMonth(d("2026-01-15T00:00:00Z")), 31);
		assert.equal(daysInMonth(d("2026-04-01T00:00:00Z")), 30);
		assert.equal(daysInMonth(d("2025-02-10T00:00:00Z")), 28);
		assert.equal(daysInMonth(d("2024-02-10T00:00:00Z")), 29);
		assert.equal(daysInMonth(d("2000-02-10T00:00:00Z")), 29);
		assert.equal(daysInMonth(d("1900-02-10T00:00:00Z")), 28);
		assert.equal(daysInMonth(d("2026-12-31T23:59:59Z")), 31);
	});
});

describe("convert", () => {
	test("USD is identity", () => {
		assert.equal(convert(1500, "USD"), 1500);
		assert.equal(convert(0, "USD"), 0);
	});
	test("EUR applies rate and rounds to cents", () => {
		assert.equal(convert(1500, "EUR"), 1380);
		assert.equal(convert(1, "EUR"), 1);
	});
	test("JPY has no minor units and rounds half away from zero", () => {
		assert.equal(convert(1500, "JPY"), 2243);
		assert.equal(convert(-1500, "JPY"), -2243);
		assert.equal(convert(100, "JPY"), 150);
	});
	test("negative amounts mirror positive ones", () => {
		assert.equal(convert(-1500, "EUR"), -1380);
	});
	test("rejects unsupported currencies", () => {
		assert.throws(() => convert(100, "GBP"), RangeError);
	});
});

describe("monthlyPrice", () => {
	test("includes plan seats at base price", () => {
		assert.equal(monthlyPrice("free", 1), 0);
		assert.equal(monthlyPrice("team", 1), 1500);
		assert.equal(monthlyPrice("team", 5), 1500);
		assert.equal(monthlyPrice("business", 20), 4900);
	});
	test("charges extra seats", () => {
		assert.equal(monthlyPrice("team", 6), 1900);
		assert.equal(monthlyPrice("team", 7), 2300);
		assert.equal(monthlyPrice("business", 21), 5300);
	});
	test("rejects bad input", () => {
		assert.throws(() => monthlyPrice("enterprise", 1), RangeError);
		assert.throws(() => monthlyPrice("team", 0), RangeError);
		assert.throws(() => monthlyPrice("team", -1), RangeError);
		assert.throws(() => monthlyPrice("team", 1.5), RangeError);
		assert.throws(() => monthlyPrice("team", "5"), RangeError);
		assert.throws(() => monthlyPrice("free", 2), /one seat/);
	});
});

describe("invoice", () => {
	const base = { plan: "team", seats: 5, interval: "month", currency: "USD" };

	test("monthly without coupon", () => {
		assert.deepEqual(invoice(base), { subtotal: 1500, discount: 0, total: 1500, currency: "USD" });
	});
	test("annual charges ten months", () => {
		assert.deepEqual(invoice({ ...base, interval: "year" }), { subtotal: 15000, discount: 0, total: 15000, currency: "USD" });
	});
	test("free plan invoices zero", () => {
		assert.deepEqual(invoice({ ...base, plan: "free", seats: 1 }), { subtotal: 0, discount: 0, total: 0, currency: "USD" });
	});
	test("percent coupon", () => {
		assert.deepEqual(invoice({ ...base, coupon: { percent: 20 } }), { subtotal: 1500, discount: 300, total: 1200, currency: "USD" });
		assert.equal(invoice({ ...base, coupon: { percent: 100 } }).total, 0);
	});
	test("percent coupon rounds the discount", () => {
		// 1500 * 33.33% = 499.95 -> 500
		assert.equal(invoice({ ...base, coupon: { percent: 33.33 } }).discount, 500);
	});
	test("percent outside (0, 100] is rejected", () => {
		assert.throws(() => invoice({ ...base, coupon: { percent: 0 } }), RangeError);
		assert.throws(() => invoice({ ...base, coupon: { percent: -5 } }), RangeError);
		assert.throws(() => invoice({ ...base, coupon: { percent: 100.01 } }), RangeError);
	});
	test("amountOff coupon is capped at the price", () => {
		assert.equal(invoice({ ...base, coupon: { amountOff: 500 } }).total, 1000);
		const capped = invoice({ ...base, coupon: { amountOff: 5000 } });
		assert.equal(capped.discount, 1500);
		assert.equal(capped.total, 0);
	});
	test("percent takes precedence over amountOff", () => {
		assert.equal(invoice({ ...base, coupon: { percent: 10, amountOff: 1000 } }).discount, 150);
	});
	test("coupon applies only for its months", () => {
		const coupon = { percent: 50, months: 3 };
		assert.equal(invoice({ ...base, coupon }).discount, 750);
		assert.equal(invoice({ ...base, coupon, periodIndex: 2 }).discount, 750);
		assert.equal(invoice({ ...base, coupon, periodIndex: 3 }).discount, 0);
		assert.equal(invoice({ ...base, coupon: { percent: 50, months: 0 } }).discount, 0);
	});
	test("an expired coupon is not validated", () => {
		assert.equal(invoice({ ...base, coupon: { percent: 500, months: 1 }, periodIndex: 1 }).total, 1500);
	});
	test("coupon without months lasts forever", () => {
		assert.equal(invoice({ ...base, coupon: { amountOff: 100 }, periodIndex: 999 }).discount, 100);
	});
	test("converts subtotal and discount to the currency", () => {
		assert.deepEqual(invoice({ ...base, interval: "year", currency: "EUR", coupon: { percent: 20 } }), {
			subtotal: 13800,
			discount: 2760,
			total: 11040,
			currency: "EUR",
		});
		assert.deepEqual(invoice({ ...base, currency: "JPY" }), { subtotal: 2243, discount: 0, total: 2243, currency: "JPY" });
	});
	test("propagates plan and currency errors", () => {
		assert.throws(() => invoice({ ...base, plan: "nope" }), RangeError);
		assert.throws(() => invoice({ ...base, currency: "GBP" }), RangeError);
	});
});

describe("prorate", () => {
	test("full month when changed on the first", () => {
		assert.equal(prorate({ fromMonthly: 1500, toMonthly: 2300, changedAt: d("2026-03-01T00:00:00Z") }), 800);
	});
	test("charges the remaining fraction, counting the change day", () => {
		assert.equal(prorate({ fromMonthly: 1500, toMonthly: 2300, changedAt: d("2026-02-15T12:00:00Z") }), 400);
		assert.equal(prorate({ fromMonthly: 1500, toMonthly: 2300, changedAt: d("2026-03-31T00:00:00Z") }), 26);
	});
	test("downgrade gives a credit", () => {
		assert.equal(prorate({ fromMonthly: 2300, toMonthly: 1500, changedAt: d("2026-02-15T00:00:00Z") }), -400);
	});
	test("no change is zero", () => {
		assert.equal(prorate({ fromMonthly: 1500, toMonthly: 1500, changedAt: d("2026-02-15T00:00:00Z") }), 0);
	});
	test("rounds half away from zero", () => {
		assert.equal(prorate({ fromMonthly: 0, toMonthly: 1, changedAt: d("2026-02-15T00:00:00Z") }), 1);
		assert.equal(prorate({ fromMonthly: 1, toMonthly: 0, changedAt: d("2026-02-15T00:00:00Z") }), -1);
	});
	test("uses leap-year February length", () => {
		// 29 days, change on the 1st -> full difference
		assert.equal(prorate({ fromMonthly: 0, toMonthly: 2900, changedAt: d("2024-02-01T00:00:00Z") }), 2900);
		assert.equal(prorate({ fromMonthly: 0, toMonthly: 2900, changedAt: d("2024-02-29T00:00:00Z") }), 100);
	});
});

describe("status", () => {
	const start = d("2026-01-01T00:00:00Z");
	const periodEnd = d("2026-02-01T00:00:00Z");
	const at = (days) => new Date(start.getTime() + days * DAY);

	test("paid plan trials for 14 days", () => {
		const sub = { plan: "team", startedAt: start, periodEnd };
		assert.equal(status(sub, start), "trialing");
		assert.equal(status(sub, new Date(at(TRIAL_DAYS).getTime() - 1)), "trialing");
		assert.equal(status(sub, at(TRIAL_DAYS)), "active");
	});
	test("free plan is active immediately", () => {
		assert.equal(status({ plan: "free", startedAt: start, periodEnd }, start), "active");
	});
	test("unpaid is past_due within grace, suspended after", () => {
		const sub = { plan: "team", startedAt: start, periodEnd, unpaidSince: at(20) };
		assert.equal(status(sub, at(20)), "past_due");
		assert.equal(status(sub, new Date(at(27).getTime() - 1)), "past_due");
		assert.equal(status(sub, at(27)), "suspended");
	});
	test("unpaid takes precedence over trialing", () => {
		const sub = { plan: "team", startedAt: start, periodEnd, unpaidSince: start };
		assert.equal(status(sub, at(1)), "past_due");
	});
	test("canceled only after period end", () => {
		const sub = { plan: "team", startedAt: start, periodEnd, canceledAt: at(20) };
		assert.equal(status(sub, at(25)), "active");
		assert.equal(status(sub, periodEnd), "canceled");
	});
	test("canceled takes precedence over unpaid", () => {
		const sub = { plan: "team", startedAt: start, periodEnd, canceledAt: at(20), unpaidSince: at(10) };
		assert.equal(status(sub, at(25)), "suspended");
		assert.equal(status(sub, at(40)), "canceled");
	});
	test("period end without cancellation stays active", () => {
		assert.equal(status({ plan: "team", startedAt: start, periodEnd }, at(60)), "active");
	});
});
