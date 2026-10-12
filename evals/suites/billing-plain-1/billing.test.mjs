import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
	ANNUAL_MONTHS_CHARGED,
	EXTRA_SEAT,
	GRACE_DAYS,
	MINOR_UNITS,
	PLANS,
	RATES,
	TRIAL_DAYS,
	convert,
	daysInMonth,
	invoice,
	monthlyPrice,
	prorate,
	status,
} from "./billing.mjs";

const DAY = 86_400_000;
const utc = (y, m, d, h = 0) => new Date(Date.UTC(y, m - 1, d, h));

describe("constants", () => {
	test("have the documented values", () => {
		assert.deepEqual(MINOR_UNITS, { USD: 2, EUR: 2, JPY: 0 });
		assert.deepEqual(PLANS, {
			free: { monthly: 0, seats: 1 },
			team: { monthly: 1500, seats: 5 },
			business: { monthly: 4900, seats: 20 },
		});
		assert.equal(EXTRA_SEAT, 400);
		assert.equal(ANNUAL_MONTHS_CHARGED, 10);
		assert.deepEqual(RATES, { USD: 1, EUR: 0.92, JPY: 149.5 });
		assert.equal(GRACE_DAYS, 7);
		assert.equal(TRIAL_DAYS, 14);
	});
});

describe("daysInMonth", () => {
	test("31-day and 30-day months", () => {
		assert.equal(daysInMonth(utc(2024, 1, 10)), 31);
		assert.equal(daysInMonth(utc(2024, 4, 30)), 30);
		assert.equal(daysInMonth(utc(2024, 12, 31)), 31);
	});

	test("February in leap and common years", () => {
		assert.equal(daysInMonth(utc(2024, 2, 1)), 29);
		assert.equal(daysInMonth(utc(2023, 2, 1)), 28);
		assert.equal(daysInMonth(utc(2000, 2, 1)), 29);
		assert.equal(daysInMonth(utc(2100, 2, 1)), 28);
	});

	test("uses the UTC month, not local time", () => {
		// Last instant of January in UTC is still January.
		assert.equal(daysInMonth(new Date(Date.UTC(2023, 0, 31, 23, 59, 59, 999))), 31);
		// First instant of February in UTC is February.
		assert.equal(daysInMonth(new Date(Date.UTC(2023, 1, 1, 0, 0, 0, 0))), 28);
	});
});

describe("convert", () => {
	test("USD is unchanged", () => {
		assert.equal(convert(1500, "USD"), 1500);
		assert.equal(convert(0, "USD"), 0);
	});

	test("EUR applies the rate at two minor units", () => {
		assert.equal(convert(1500, "EUR"), 1380);
		assert.equal(convert(4900, "EUR"), 4508);
		assert.equal(convert(1, "EUR"), 1);
	});

	test("JPY has no minor units and rounds half away from zero", () => {
		// 15 USD * 149.5 = 2242.5 JPY
		assert.equal(convert(1500, "JPY"), 2243);
		assert.equal(convert(-1500, "JPY"), -2243);
		// 1 USD = 149.5 JPY
		assert.equal(convert(100, "JPY"), 150);
		assert.equal(convert(-100, "JPY"), -150);
	});

	test("negative amounts convert symmetrically", () => {
		assert.equal(convert(-1500, "EUR"), -1380);
		assert.equal(convert(-1500, "USD"), -1500);
	});

	test("returns an integer", () => {
		for (const amount of [1, 7, 333, 1234, 99999]) {
			for (const currency of Object.keys(RATES)) {
				assert.ok(Number.isInteger(convert(amount, currency)), `${amount} ${currency}`);
			}
		}
	});

	test("rejects an unsupported currency", () => {
		assert.throws(() => convert(100, "GBP"), RangeError);
		assert.throws(() => convert(100, undefined), RangeError);
	});
});

describe("monthlyPrice", () => {
	test("included seats cost the plan price", () => {
		assert.equal(monthlyPrice("free", 1), 0);
		assert.equal(monthlyPrice("team", 1), 1500);
		assert.equal(monthlyPrice("team", 5), 1500);
		assert.equal(monthlyPrice("business", 20), 4900);
	});

	test("extra seats cost EXTRA_SEAT each", () => {
		assert.equal(monthlyPrice("team", 6), 1900);
		assert.equal(monthlyPrice("team", 7), 2300);
		assert.equal(monthlyPrice("business", 21), 5300);
		assert.equal(monthlyPrice("business", 30), 4900 + 10 * 400);
	});

	test("free plan allows only one seat", () => {
		assert.throws(() => monthlyPrice("free", 2), { name: "RangeError", message: "the free plan has one seat" });
	});

	test("seats must be a positive integer", () => {
		for (const seats of [0, -1, 1.5, NaN, Infinity, "3", undefined, null]) {
			assert.throws(() => monthlyPrice("team", seats), RangeError, String(seats));
		}
	});

	test("rejects an unknown plan", () => {
		assert.throws(() => monthlyPrice("enterprise", 1), { name: "RangeError", message: "unknown plan enterprise" });
	});
});

describe("invoice", () => {
	const base = { plan: "team", seats: 5, interval: "month", currency: "USD" };

	test("monthly invoice without coupon", () => {
		assert.deepEqual(invoice(base), { subtotal: 1500, discount: 0, total: 1500, currency: "USD" });
	});

	test("annual invoice charges ten months", () => {
		assert.deepEqual(invoice({ ...base, interval: "year" }), {
			subtotal: 15000,
			discount: 0,
			total: 15000,
			currency: "USD",
		});
	});

	test("extra seats are included in the subtotal", () => {
		assert.equal(invoice({ ...base, seats: 7 }).subtotal, 2300);
	});

	test("free plan invoices zero", () => {
		assert.deepEqual(invoice({ ...base, plan: "free", seats: 1 }), {
			subtotal: 0,
			discount: 0,
			total: 0,
			currency: "USD",
		});
	});

	test("percent coupon", () => {
		assert.deepEqual(invoice({ ...base, coupon: { percent: 20 } }), {
			subtotal: 1500,
			discount: 300,
			total: 1200,
			currency: "USD",
		});
	});

	test("percent coupon rounds the USD discount", () => {
		// 1500 * 0.1% = 1.5 -> 2
		assert.equal(invoice({ ...base, coupon: { percent: 0.1 } }).discount, 2);
		// 1900 * 33% = 627
		assert.equal(invoice({ ...base, seats: 6, coupon: { percent: 33 } }).discount, 627);
	});

	test("100 percent coupon makes the invoice free", () => {
		const result = invoice({ ...base, coupon: { percent: 100 } });
		assert.equal(result.discount, 1500);
		assert.equal(result.total, 0);
	});

	test("percent outside (0, 100] is rejected", () => {
		for (const percent of [0, -5, 100.01, 150]) {
			assert.throws(() => invoice({ ...base, coupon: { percent } }), RangeError, String(percent));
		}
	});

	test("amountOff coupon", () => {
		assert.deepEqual(invoice({ ...base, coupon: { amountOff: 500 } }), {
			subtotal: 1500,
			discount: 500,
			total: 1000,
			currency: "USD",
		});
	});

	test("amountOff is capped at the subtotal", () => {
		const result = invoice({ ...base, coupon: { amountOff: 2000 } });
		assert.equal(result.discount, 1500);
		assert.equal(result.total, 0);
	});

	test("percent takes precedence over amountOff", () => {
		assert.equal(invoice({ ...base, coupon: { percent: 10, amountOff: 1000 } }).discount, 150);
	});

	test("coupon with neither percent nor amountOff gives no discount", () => {
		assert.equal(invoice({ ...base, coupon: {} }).discount, 0);
	});

	test("coupon applies to the whole annual amount", () => {
		const result = invoice({ ...base, interval: "year", coupon: { percent: 10 } });
		assert.equal(result.subtotal, 15000);
		assert.equal(result.discount, 1500);
		assert.equal(result.total, 13500);
	});

	test("limited coupon applies only for its first months", () => {
		const coupon = { percent: 50, months: 3 };
		assert.equal(invoice({ ...base, coupon }).discount, 750, "periodIndex defaults to 0");
		assert.equal(invoice({ ...base, coupon, periodIndex: 0 }).discount, 750);
		assert.equal(invoice({ ...base, coupon, periodIndex: 2 }).discount, 750);
		assert.equal(invoice({ ...base, coupon, periodIndex: 3 }).discount, 0);
		assert.equal(invoice({ ...base, coupon, periodIndex: 10 }).total, 1500);
	});

	test("coupon with months 0 never applies", () => {
		assert.equal(invoice({ ...base, coupon: { amountOff: 500, months: 0 } }).discount, 0);
	});

	test("coupon without months applies forever", () => {
		assert.equal(invoice({ ...base, coupon: { amountOff: 500 }, periodIndex: 1000 }).discount, 500);
	});

	test("an expired coupon with an invalid percent is not validated", () => {
		assert.doesNotThrow(() => invoice({ ...base, coupon: { percent: 0, months: 1 }, periodIndex: 1 }));
	});

	test("converts subtotal and discount to EUR", () => {
		assert.deepEqual(invoice({ ...base, currency: "EUR", coupon: { percent: 20 } }), {
			subtotal: 1380,
			discount: 276,
			total: 1104,
			currency: "EUR",
		});
	});

	test("converts subtotal and discount to JPY separately", () => {
		// subtotal 15 USD -> 2242.5 -> 2243; discount 1.5 USD -> 224.25 -> 224
		assert.deepEqual(invoice({ ...base, currency: "JPY", coupon: { percent: 10 } }), {
			subtotal: 2243,
			discount: 224,
			total: 2019,
			currency: "JPY",
		});
	});

	test("total always equals subtotal minus discount", () => {
		for (const currency of Object.keys(RATES)) {
			for (const seats of [1, 5, 6, 13]) {
				for (const coupon of [undefined, { percent: 15 }, { amountOff: 777 }]) {
					const r = invoice({ plan: "team", seats, interval: "month", currency, coupon });
					assert.equal(r.total, r.subtotal - r.discount);
					assert.ok(r.total >= 0);
				}
			}
		}
	});

	test("propagates plan, seat and currency errors", () => {
		assert.throws(() => invoice({ ...base, plan: "nope" }), RangeError);
		assert.throws(() => invoice({ ...base, seats: 0 }), RangeError);
		assert.throws(() => invoice({ ...base, plan: "free", seats: 2 }), RangeError);
		assert.throws(() => invoice({ ...base, currency: "CHF" }), RangeError);
	});
});

describe("prorate", () => {
	test("upgrade on the first day charges the full difference", () => {
		assert.equal(prorate({ fromMonthly: 1500, toMonthly: 4900, changedAt: utc(2024, 4, 1) }), 3400);
	});

	test("downgrade on the first day credits the full difference", () => {
		assert.equal(prorate({ fromMonthly: 4900, toMonthly: 1500, changedAt: utc(2024, 4, 1) }), -3400);
	});

	test("counts the change day as remaining", () => {
		// April: 30 days, change on 16th -> 15 days remaining -> half
		assert.equal(prorate({ fromMonthly: 1500, toMonthly: 1900, changedAt: utc(2024, 4, 16) }), 200);
		// last day: one day remaining
		assert.equal(prorate({ fromMonthly: 0, toMonthly: 3000, changedAt: utc(2024, 4, 30) }), 100);
	});

	test("uses the actual month length", () => {
		// Feb 2024: 29 days, change on 15th -> 15 remaining; 3400 * 15 / 29 = 1758.62
		assert.equal(prorate({ fromMonthly: 1500, toMonthly: 4900, changedAt: utc(2024, 2, 15) }), 1759);
		// Feb 2023: 28 days, change on 15th -> 14 remaining -> half
		assert.equal(prorate({ fromMonthly: 1500, toMonthly: 4900, changedAt: utc(2023, 2, 15) }), 1700);
	});

	test("rounds half away from zero in both directions", () => {
		// 1 * 15 / 30 = 0.5
		assert.equal(prorate({ fromMonthly: 0, toMonthly: 1, changedAt: utc(2024, 4, 16) }), 1);
		assert.equal(prorate({ fromMonthly: 1, toMonthly: 0, changedAt: utc(2024, 4, 16) }), -1);
	});

	test("no change yields zero", () => {
		assert.equal(Math.abs(prorate({ fromMonthly: 1500, toMonthly: 1500, changedAt: utc(2024, 4, 10) })), 0);
	});

	test("uses the UTC date of the change", () => {
		// 23:00 UTC on April 30 is still the last day in UTC
		assert.equal(prorate({ fromMonthly: 0, toMonthly: 3000, changedAt: utc(2024, 4, 30, 23) }), 100);
	});
});

describe("status", () => {
	const startedAt = utc(2024, 1, 1);
	const periodEnd = utc(2024, 3, 1);

	test("paid plan is trialing during the trial", () => {
		const sub = { plan: "team", startedAt, periodEnd };
		assert.equal(status(sub, startedAt), "trialing");
		assert.equal(status(sub, new Date(startedAt.getTime() + TRIAL_DAYS * DAY - 1)), "trialing");
	});

	test("paid plan is active once the trial ends", () => {
		const sub = { plan: "business", startedAt, periodEnd };
		assert.equal(status(sub, new Date(startedAt.getTime() + TRIAL_DAYS * DAY)), "active");
		assert.equal(status(sub, utc(2024, 2, 1)), "active");
	});

	test("free plan never trials", () => {
		assert.equal(status({ plan: "free", startedAt, periodEnd }, startedAt), "active");
	});

	test("unpaid within the grace period is past_due", () => {
		const unpaidSince = utc(2024, 2, 1);
		const sub = { plan: "team", startedAt, periodEnd, unpaidSince };
		assert.equal(status(sub, unpaidSince), "past_due");
		assert.equal(status(sub, new Date(unpaidSince.getTime() + GRACE_DAYS * DAY - 1)), "past_due");
	});

	test("unpaid for the grace period or longer is suspended", () => {
		const unpaidSince = utc(2024, 2, 1);
		const sub = { plan: "team", startedAt, periodEnd, unpaidSince };
		assert.equal(status(sub, new Date(unpaidSince.getTime() + GRACE_DAYS * DAY)), "suspended");
		assert.equal(status(sub, utc(2024, 2, 20)), "suspended");
	});

	test("unpaid takes precedence over trialing", () => {
		const sub = { plan: "team", startedAt, periodEnd, unpaidSince: startedAt };
		assert.equal(status(sub, utc(2024, 1, 3)), "past_due");
	});

	test("canceled once the period ends", () => {
		const sub = { plan: "team", startedAt, periodEnd, canceledAt: utc(2024, 2, 10) };
		assert.equal(status(sub, periodEnd), "canceled");
		assert.equal(status(sub, utc(2024, 6, 1)), "canceled");
	});

	test("canceled subscription keeps its state until the period ends", () => {
		const sub = { plan: "team", startedAt, periodEnd, canceledAt: utc(2024, 2, 10) };
		assert.equal(status(sub, utc(2024, 2, 20)), "active");
		assert.equal(status(sub, new Date(periodEnd.getTime() - 1)), "active");
		assert.equal(status({ ...sub, canceledAt: utc(2024, 1, 2) }, utc(2024, 1, 5)), "trialing");
	});

	test("canceled takes precedence over unpaid", () => {
		const sub = { plan: "team", startedAt, periodEnd, canceledAt: utc(2024, 2, 1), unpaidSince: utc(2024, 2, 1) };
		assert.equal(status(sub, utc(2024, 2, 20)), "suspended");
		assert.equal(status(sub, periodEnd), "canceled");
	});

	test("periodEnd without canceledAt does not cancel", () => {
		assert.equal(status({ plan: "team", startedAt, periodEnd }, utc(2025, 1, 1)), "active");
	});
});
