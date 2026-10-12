// Tests for pricing.mjs. Every expected amount below is worked out by hand from the stated rules
// (bulk 5% from 10 units, free shipping from 5000 cents after discount, 499 shipping fee,
// 8.25% tax on the discounted amount, halves rounded up), never copied from a run.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { lineAmount, priceCart, roundCents } from "./pricing.mjs";

/**
 * Build a cart line.
 *
 * @param {number} unitCents - Unit price in cents.
 * @param {number} quantity - Quantity.
 * @returns {{ unitCents: number, quantity: number }} The line.
 */
function line(unitCents, quantity) {
	return { unitCents, quantity };
}

describe("roundCents", function roundCentsSuite() {
	const cases = [
		{ input: 0, expected: 0 },
		{ input: 7, expected: 7 },
		{ input: 2.4, expected: 2 },
		{ input: 2.49, expected: 2 },
		{ input: 2.5, expected: 3 },
		{ input: 2.51, expected: 3 },
		{ input: 0.5, expected: 1 },
		{ input: 412.5, expected: 413 },
	];

	test("rounds halves up and everything else to the nearest cent", function roundsTable() {
		const offenders = cases.filter(function isWrong(c) {
			return roundCents(c.input) !== c.expected;
		});

		assert.deepEqual(offenders, []);
	});

	test("is idempotent on whole cents", function idempotent() {
		const offenders = [0, 1, 99, 500, 12345].filter(function changes(value) {
			return roundCents(roundCents(value)) !== value;
		});

		assert.deepEqual(offenders, []);
	});
});

describe("lineAmount", function lineAmountSuite() {
	const cases = [
		{ name: "zero quantity", line: line(100, 0), expected: 0 },
		{ name: "free item", line: line(0, 3), expected: 0 },
		{ name: "single unit", line: line(250, 1), expected: 250 },
		{ name: "one below bulk threshold, no discount", line: line(100, 9), expected: 900 },
		{ name: "at bulk threshold, 5% off", line: line(100, 10), expected: 950 },
		{ name: "above bulk threshold, 5% off", line: line(100, 20), expected: 1900 },
		{ name: "bulk discount of 99.5 rounds up to 100", line: line(199, 10), expected: 1890 },
		{ name: "bulk discount of 16.5 rounds up to 17", line: line(33, 10), expected: 313 },
		{ name: "bulk discount of 8.4 rounds down to 8", line: line(14, 12), expected: 160 },
		{ name: "bulk discount of 6.6 rounds up to 7", line: line(11, 12), expected: 125 },
	];

	test("prices lines, applying the bulk discount from 10 units", function pricesTable() {
		const offenders = cases
			.map(function evaluate(c) {
				return { name: c.name, expected: c.expected, actual: lineAmount(c.line) };
			})
			.filter(function isWrong(r) {
				return r.actual !== r.expected;
			});

		assert.deepEqual(offenders, []);
	});

	const neverAccepts = [
		{ name: "negative quantity", line: line(100, -1), message: /quantity/ },
		{ name: "fractional quantity", line: line(100, 1.5), message: /quantity/ },
		{ name: "NaN quantity", line: line(100, Number.NaN), message: /quantity/ },
		{ name: "string quantity", line: line(100, "2"), message: /quantity/ },
		{ name: "null quantity", line: line(100, null), message: /quantity/ },
		{ name: "infinite quantity", line: line(100, Number.POSITIVE_INFINITY), message: /quantity/ },
		{ name: "negative unit price", line: line(-1, 1), message: /unit price/ },
		{ name: "fractional unit price", line: line(1.5, 1), message: /unit price/ },
		{ name: "string unit price", line: line("100", 1), message: /unit price/ },
		{ name: "missing unit price", line: { quantity: 1 }, message: /unit price/ },
	];

	for (const c of neverAccepts) {
		test(`rejects ${c.name} with a RangeError`, function rejects() {
			assert.throws(
				function price() {
					lineAmount(c.line);
				},
				{ name: "RangeError", message: c.message },
			);
		});
	}
});

describe("priceCart", function priceCartSuite() {
	test("an empty cart costs nothing and pays no shipping", function emptyCart() {
		assert.deepEqual(priceCart([]), { subtotal: 0, discount: 0, shipping: 0, tax: 0, total: 0, coupon: null });
	});

	test("a small order pays the 499 shipping fee and tax on the goods only", function smallOrder() {
		// 1000 goods, tax 82.5 -> 83, shipping not taxed.
		assert.deepEqual(priceCart([line(1000, 1)]), { subtotal: 1000, discount: 0, shipping: 499, tax: 83, total: 1582, coupon: null });
	});

	test("sums lines, each with its own bulk discount", function sumsLines() {
		// 950 (10 x 100 less 5%) + 500 (2 x 250); tax 119.625 -> 120.
		assert.deepEqual(priceCart([line(100, 10), line(250, 2)]), {
			subtotal: 1450,
			discount: 0,
			shipping: 499,
			tax: 120,
			total: 2069,
			coupon: null,
		});
	});

	test("one cent below the free-shipping threshold still pays shipping", function belowFreeShipping() {
		// tax 412.41675 -> 412.
		assert.deepEqual(priceCart([line(4999, 1)]), { subtotal: 4999, discount: 0, shipping: 499, tax: 412, total: 5910, coupon: null });
	});

	test("an order of exactly 5000 ships free", function atFreeShipping() {
		// tax 412.5 -> 413.
		assert.deepEqual(priceCart([line(5000, 1)]), { subtotal: 5000, discount: 0, shipping: 0, tax: 413, total: 5413, coupon: null });
	});

	test("a cart of only free items pays no shipping", function freeItems() {
		assert.deepEqual(priceCart([line(0, 2)]), { subtotal: 0, discount: 0, shipping: 0, tax: 0, total: 0, coupon: null });
	});

	test("an invalid line makes the whole cart throw", function invalidLine() {
		assert.throws(
			function price() {
				priceCart([line(100, 1), line(100, -2)]);
			},
			{ name: "RangeError" },
		);
	});

	describe("coupons", function couponsSuite() {
		test("SAVE10 takes 10% off and is reported", function save10() {
			// 3000 - 300 = 2700; tax 222.75 -> 223.
			assert.deepEqual(priceCart([line(3000, 1)], "SAVE10"), {
				subtotal: 3000,
				discount: 300,
				shipping: 499,
				tax: 223,
				total: 3422,
				coupon: "SAVE10",
			});
		});

		test("SAVE10 rounds a half-cent discount up", function save10Rounding() {
			// 10% of 1005 = 100.5 -> 101; 904 left, tax 74.58 -> 75.
			assert.deepEqual(priceCart([line(1005, 1)], "SAVE10"), {
				subtotal: 1005,
				discount: 101,
				shipping: 499,
				tax: 75,
				total: 1478,
				coupon: "SAVE10",
			});
		});

		test("SAVE10 has no minimum and applies even to an empty cart", function save10NoMinimum() {
			assert.deepEqual(priceCart([], "SAVE10"), { subtotal: 0, discount: 0, shipping: 0, tax: 0, total: 0, coupon: "SAVE10" });
		});

		test("free shipping is judged after the discount: 5000 less 10% pays shipping", function shippingAfterDiscount() {
			// 5000 - 500 = 4500; tax 371.25 -> 371.
			assert.deepEqual(priceCart([line(5000, 1)], "SAVE10"), {
				subtotal: 5000,
				discount: 500,
				shipping: 499,
				tax: 371,
				total: 5370,
				coupon: "SAVE10",
			});
		});

		test("a discounted amount of exactly 5000 ships free", function discountedAtThreshold() {
			// 10% of 5556 = 555.6 -> 556; 5000 left; tax 412.5 -> 413.
			assert.deepEqual(priceCart([line(5556, 1)], "SAVE10"), {
				subtotal: 5556,
				discount: 556,
				shipping: 0,
				tax: 413,
				total: 5413,
				coupon: "SAVE10",
			});
		});

		test("FLAT500 takes 500 off at its 2000 minimum", function flat500AtMinimum() {
			// 1500 left; tax 123.75 -> 124.
			assert.deepEqual(priceCart([line(2000, 1)], "FLAT500"), {
				subtotal: 2000,
				discount: 500,
				shipping: 499,
				tax: 124,
				total: 2123,
				coupon: "FLAT500",
			});
		});

		test("FLAT500 is not applied one cent below its minimum", function flat500BelowMinimum() {
			// tax 164.9175 -> 165.
			assert.deepEqual(priceCart([line(1999, 1)], "FLAT500"), {
				subtotal: 1999,
				discount: 0,
				shipping: 499,
				tax: 165,
				total: 2663,
				coupon: null,
			});
		});

		test("FREESHIP waives shipping at its 1000 minimum without discounting goods", function freeshipAtMinimum() {
			assert.deepEqual(priceCart([line(1000, 1)], "FREESHIP"), {
				subtotal: 1000,
				discount: 0,
				shipping: 0,
				tax: 83,
				total: 1083,
				coupon: "FREESHIP",
			});
		});

		test("FREESHIP is not applied one cent below its minimum", function freeshipBelowMinimum() {
			// tax 82.4175 -> 82.
			assert.deepEqual(priceCart([line(999, 1)], "FREESHIP"), {
				subtotal: 999,
				discount: 0,
				shipping: 499,
				tax: 82,
				total: 1580,
				coupon: null,
			});
		});

		test("codes are trimmed and case-insensitive, and reported in canonical form", function normalizesCode() {
			const variants = ["save10", " SAVE10 ", "Save10", "\tsave10\n"];
			const offenders = variants
				.map(function evaluate(code) {
					const result = priceCart([line(3000, 1)], code);

					return { code, coupon: result.coupon, discount: result.discount };
				})
				.filter(function isWrong(r) {
					return r.coupon !== "SAVE10" || r.discount !== 300;
				});

			assert.deepEqual(offenders, []);
		});

		test("unknown, blank or missing codes change nothing", function neverAcceptsCodes() {
			// 3000 goods, tax 247.5 -> 248.
			const expected = { subtotal: 3000, discount: 0, shipping: 499, tax: 248, total: 3747, coupon: null };
			const codes = [undefined, "", "   ", "BOGUS", "SAVE 10", "SAVE1O", "constructor", "__proto__", "toString"];
			const offenders = codes
				.map(function evaluate(code) {
					return { code, result: priceCart([line(3000, 1)], code) };
				})
				.filter(function isWrong(r) {
					return JSON.stringify(r.result) !== JSON.stringify(expected);
				});

			assert.deepEqual(offenders, []);
		});
	});
});
