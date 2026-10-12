// Tests for pricing.mjs. Every expected amount below is computed by hand from the documented rules
// (5% bulk discount from 10 units, 8.25% tax, 499 shipping under 5000, coupons), never by calling
// the module, so a wrong rule or constant in the code breaks a test.

import { test } from "node:test";
import assert from "node:assert/strict";

import { lineAmount, priceCart, roundCents } from "./pricing.mjs";

/**
 * Build a cart of one line whose subtotal is exactly `cents` (quantity 1, so no bulk discount).
 *
 * @param {number} cents - Desired subtotal.
 * @returns {Array<{ unitCents: number, quantity: number }>} The cart lines.
 */
function cartOf(cents) {
	return [{ unitCents: cents, quantity: 1 }];
}

/**
 * Invariant that must hold for every priced cart: total = subtotal - discount + shipping + tax.
 *
 * @param {{ subtotal: number, discount: number, shipping: number, tax: number, total: number }} result - A breakdown.
 * @returns {boolean} Whether the breakdown adds up.
 */
function addsUp(result) {
	return result.total === result.subtotal - result.discount + result.shipping + result.tax;
}

test("roundCents rounds halves up and everything else to the nearest cent", function roundCentsTable() {
	const table = [
		[0, 0],
		[0.49, 0],
		[0.5, 1],
		[1.5, 2],
		[2.5, 3],
		[412.4175, 412],
		[412.5, 413],
		[7, 7],
	];
	const offenders = table.filter(function isWrong([input, expected]) {
		return roundCents(input) !== expected;
	});

	assert.deepEqual(offenders, []);
});

test("lineAmount multiplies price by quantity below the bulk threshold", function belowBulk() {
	assert.equal(lineAmount({ unitCents: 250, quantity: 9 }), 2250);
	assert.equal(lineAmount({ unitCents: 250, quantity: 1 }), 250);
	assert.equal(lineAmount({ unitCents: 250, quantity: 0 }), 0);
	assert.equal(lineAmount({ unitCents: 0, quantity: 3 }), 0);
});

test("lineAmount takes 5% off a line of exactly 10 units", function atBulk() {
	// 10 x 100 = 1000, 5% = 50.
	assert.equal(lineAmount({ unitCents: 100, quantity: 10 }), 950);
});

test("lineAmount rounds the bulk discount half up", function bulkRounding() {
	const table = [
		// gross 10, 5% = 0.5 -> 1
		[{ unitCents: 1, quantity: 10 }, 9],
		// gross 30, 5% = 1.5 -> 2
		[{ unitCents: 3, quantity: 10 }, 28],
		// gross 11, 5% = 0.55 -> 1
		[{ unitCents: 1, quantity: 11 }, 10],
		// gross 48, 5% = 2.4 -> 2
		[{ unitCents: 4, quantity: 12 }, 46],
	];
	const offenders = table.filter(function isWrong([line, expected]) {
		return lineAmount(line) !== expected;
	});

	assert.deepEqual(offenders, []);
});

test("lineAmount refuses a quantity that is not a non-negative integer", function badQuantity() {
	const invalid = [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "2", null, undefined, {}];
	const accepted = invalid.filter(function isAccepted(quantity) {
		try {
			lineAmount({ unitCents: 100, quantity });
			return true;
		} catch (error) {
			return !(error instanceof RangeError && /quantity/.test(error.message));
		}
	});

	assert.deepEqual(accepted, []);
});

test("lineAmount refuses a unit price that is not a non-negative integer", function badPrice() {
	const invalid = [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, "100", null, undefined, {}];
	const accepted = invalid.filter(function isAccepted(unitCents) {
		try {
			lineAmount({ unitCents, quantity: 1 });
			return true;
		} catch (error) {
			return !(error instanceof RangeError && /unit price/.test(error.message));
		}
	});

	assert.deepEqual(accepted, []);
});

test("priceCart prices an empty cart at zero, with no shipping", function emptyCart() {
	assert.deepEqual(priceCart([]), { subtotal: 0, discount: 0, shipping: 0, tax: 0, total: 0, coupon: null });
});

test("priceCart sums lines, adds shipping under 5000 and 8.25% tax", function smallCart() {
	// 2 x 300 + 10 x 100 (bulk: 950) = 1550. Tax 1550 x 0.0825 = 127.875 -> 128.
	const result = priceCart([
		{ unitCents: 300, quantity: 2 },
		{ unitCents: 100, quantity: 10 },
	]);

	assert.deepEqual(result, { subtotal: 1550, discount: 0, shipping: 499, tax: 128, total: 2177, coupon: null });
});

test("priceCart ships free from exactly 5000 and charges 499 just below", function shippingBoundary() {
	// 4999 x 0.0825 = 412.4175 -> 412. 5000 x 0.0825 = 412.5 -> 413.
	assert.deepEqual(priceCart(cartOf(4999)), { subtotal: 4999, discount: 0, shipping: 499, tax: 412, total: 5910, coupon: null });
	assert.deepEqual(priceCart(cartOf(5000)), { subtotal: 5000, discount: 0, shipping: 0, tax: 413, total: 5413, coupon: null });
});

test("priceCart charges no shipping when lines exist but the subtotal is zero", function zeroPricedLines() {
	// A cart with lines that sum to zero is treated like an empty cart: nothing to ship for.
	assert.deepEqual(priceCart([{ unitCents: 0, quantity: 4 }]), { subtotal: 0, discount: 0, shipping: 0, tax: 0, total: 0, coupon: null });
});

test("priceCart charges shipping on a 1-cent cart", function oneCent() {
	// 1 x 0.0825 = 0.0825 -> 0.
	assert.deepEqual(priceCart(cartOf(1)), { subtotal: 1, discount: 0, shipping: 499, tax: 0, total: 500, coupon: null });
});

test("SAVE10 takes 10% of the subtotal, rounded half up, and taxes the discounted amount", function save10() {
	// 1005 x 10% = 100.5 -> 101. Discounted 904. Tax 904 x 0.0825 = 74.58 -> 75.
	assert.deepEqual(priceCart(cartOf(1005), "SAVE10"), { subtotal: 1005, discount: 101, shipping: 499, tax: 75, total: 1478, coupon: "SAVE10" });
});

test("SAVE10 has no minimum: it is accepted even on a zero subtotal", function save10NoMinimum() {
	assert.deepEqual(priceCart([], "SAVE10"), { subtotal: 0, discount: 0, shipping: 0, tax: 0, total: 0, coupon: "SAVE10" });
	// 1 x 10% = 0.1 -> 0. Tax 0.
	assert.deepEqual(priceCart(cartOf(1), "save10"), { subtotal: 1, discount: 0, shipping: 499, tax: 0, total: 500, coupon: "SAVE10" });
});

test("free shipping is judged on the discounted amount, not the subtotal", function shippingAfterDiscount() {
	// 5400 - 540 = 4860, under 5000: shipping applies. Tax 4860 x 0.0825 = 400.95 -> 401.
	assert.deepEqual(priceCart(cartOf(5400), "SAVE10"), { subtotal: 5400, discount: 540, shipping: 499, tax: 401, total: 5760, coupon: "SAVE10" });
	// 5560 - 556 = 5004, at or above 5000: free. Tax 5004 x 0.0825 = 412.83 -> 413.
	assert.deepEqual(priceCart(cartOf(5560), "SAVE10"), { subtotal: 5560, discount: 556, shipping: 0, tax: 413, total: 5417, coupon: "SAVE10" });
});

test("coupon codes are trimmed and case-insensitive, and the normalized code is reported", function couponNormalization() {
	const variants = ["save10", " SAVE10 ", "\tSave10\n", "sAvE10"];
	const offenders = variants.filter(function isWrong(code) {
		const result = priceCart(cartOf(2000), code);

		return result.coupon !== "SAVE10" || result.discount !== 200;
	});

	assert.deepEqual(offenders, []);
});

test("unknown, blank or missing coupons apply nothing", function unknownCoupon() {
	// 2000 x 0.0825 = 165.
	const expected = { subtotal: 2000, discount: 0, shipping: 499, tax: 165, total: 2664, coupon: null };
	const codes = ["NOPE", "", "   ", "SAVE 10", "SAVE100", undefined];
	const offenders = codes.filter(function isWrong(code) {
		const result = priceCart(cartOf(2000), code);

		return JSON.stringify(result) !== JSON.stringify(expected);
	});

	assert.deepEqual(offenders, []);
});

test("FLAT500 needs a subtotal of 2000 and then takes 500 off", function flat500() {
	// Below the minimum: ignored. 1999 x 0.0825 = 164.9175 -> 165.
	assert.deepEqual(priceCart(cartOf(1999), "FLAT500"), { subtotal: 1999, discount: 0, shipping: 499, tax: 165, total: 2663, coupon: null });
	// At the minimum: 2000 - 500 = 1500. Tax 1500 x 0.0825 = 123.75 -> 124.
	assert.deepEqual(priceCart(cartOf(2000), "flat500"), { subtotal: 2000, discount: 500, shipping: 499, tax: 124, total: 2123, coupon: "FLAT500" });
});

test("FREESHIP needs a subtotal of 1000 and then waives shipping without a discount", function freeship() {
	// 999 x 0.0825 = 82.4175 -> 82.
	assert.deepEqual(priceCart(cartOf(999), "FREESHIP"), { subtotal: 999, discount: 0, shipping: 499, tax: 82, total: 1580, coupon: null });
	// 1000 x 0.0825 = 82.5 -> 83.
	assert.deepEqual(priceCart(cartOf(1000), "FREESHIP"), { subtotal: 1000, discount: 0, shipping: 0, tax: 83, total: 1083, coupon: "FREESHIP" });
});

test("the coupon minimum is checked against the subtotal after bulk discounts", function minimumAfterBulk() {
	// 10 x 105 = 1050 gross, bulk 5% = 52.5 -> 53, subtotal 997: below FREESHIP's 1000.
	const result = priceCart([{ unitCents: 105, quantity: 10 }], "FREESHIP");

	assert.equal(result.subtotal, 997);
	assert.equal(result.coupon, null);
	assert.equal(result.shipping, 499);
});

test("priceCart propagates an invalid line as a RangeError", function invalidLine() {
	assert.throws(function priceBadCart() {
		priceCart([
			{ unitCents: 100, quantity: 1 },
			{ unitCents: 100, quantity: -2 },
		]);
	}, RangeError);
});

test("every breakdown adds up: total = subtotal - discount + shipping + tax", function invariant() {
	const cases = [
		[[], undefined],
		[cartOf(1), undefined],
		[cartOf(4999), "SAVE10"],
		[cartOf(2500), "FLAT500"],
		[cartOf(1200), "FREESHIP"],
		[[{ unitCents: 777, quantity: 13 }], "SAVE10"],
	];
	const offenders = cases
		.map(function price([lines, code]) {
			return priceCart(lines, code);
		})
		.filter(function broken(result) {
			return !addsUp(result);
		});

	assert.deepEqual(offenders, []);
});
