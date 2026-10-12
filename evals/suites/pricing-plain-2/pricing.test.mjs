import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
	BULK_PERCENT,
	BULK_QUANTITY,
	COUPONS,
	FREE_SHIPPING_FROM,
	SHIPPING_FEE,
	TAX_BASIS_POINTS,
	lineAmount,
	priceCart,
	roundCents,
} from "./pricing.mjs";

describe("constants", () => {
	test("have the documented values", () => {
		assert.equal(BULK_QUANTITY, 10);
		assert.equal(BULK_PERCENT, 5);
		assert.equal(FREE_SHIPPING_FROM, 5000);
		assert.equal(SHIPPING_FEE, 499);
		assert.equal(TAX_BASIS_POINTS, 825);
		assert.deepEqual(Object.keys(COUPONS).sort(), ["FLAT500", "FREESHIP", "SAVE10"]);
	});
});

describe("roundCents", () => {
	test("leaves whole cents unchanged", () => {
		assert.equal(roundCents(0), 0);
		assert.equal(roundCents(42), 42);
	});

	test("rounds halves up", () => {
		assert.equal(roundCents(0.5), 1);
		assert.equal(roundCents(1.5), 2);
		assert.equal(roundCents(2.5), 3);
	});

	test("rounds below half down and above half up", () => {
		assert.equal(roundCents(1.49), 1);
		assert.equal(roundCents(1.51), 2);
	});
});

describe("lineAmount", () => {
	test("multiplies unit price by quantity below the bulk threshold", () => {
		assert.equal(lineAmount({ unitCents: 100, quantity: 3 }), 300);
		assert.equal(lineAmount({ unitCents: 100, quantity: 9 }), 900);
	});

	test("returns zero for zero quantity or zero price", () => {
		assert.equal(lineAmount({ unitCents: 100, quantity: 0 }), 0);
		assert.equal(lineAmount({ unitCents: 0, quantity: 20 }), 0);
	});

	test("applies the bulk discount at exactly the bulk quantity", () => {
		assert.equal(lineAmount({ unitCents: 100, quantity: 10 }), 950);
	});

	test("applies the bulk discount above the bulk quantity", () => {
		assert.equal(lineAmount({ unitCents: 100, quantity: 20 }), 1900);
	});

	test("rounds the bulk discount half up", () => {
		// 330 * 5% = 16.5 -> 17 off
		assert.equal(lineAmount({ unitCents: 33, quantity: 10 }), 313);
	});

	test("rejects non-integer, negative or non-numeric quantities", () => {
		for (const quantity of [-1, 1.5, Number.NaN, "2", undefined]) {
			assert.throws(() => lineAmount({ unitCents: 100, quantity }), RangeError, `quantity ${String(quantity)}`);
		}
	});

	test("rejects non-integer, negative or non-numeric unit prices", () => {
		for (const unitCents of [-1, 9.99, Number.NaN, "100", undefined]) {
			assert.throws(() => lineAmount({ unitCents, quantity: 1 }), RangeError, `unitCents ${String(unitCents)}`);
		}
	});
});

describe("priceCart", () => {
	test("prices an empty cart at zero with no shipping", () => {
		assert.deepEqual(priceCart([]), { subtotal: 0, discount: 0, shipping: 0, tax: 0, total: 0, coupon: null });
	});

	test("charges shipping and tax below the free-shipping threshold", () => {
		assert.deepEqual(priceCart([{ unitCents: 1000, quantity: 1 }]), {
			subtotal: 1000,
			discount: 0,
			shipping: 499,
			tax: 83,
			total: 1582,
			coupon: null,
		});
	});

	test("charges shipping one cent below the threshold", () => {
		assert.deepEqual(priceCart([{ unitCents: 4999, quantity: 1 }]), {
			subtotal: 4999,
			discount: 0,
			shipping: 499,
			tax: 412,
			total: 5910,
			coupon: null,
		});
	});

	test("ships free at exactly the threshold", () => {
		assert.deepEqual(priceCart([{ unitCents: 5000, quantity: 1 }]), {
			subtotal: 5000,
			discount: 0,
			shipping: 0,
			tax: 413,
			total: 5413,
			coupon: null,
		});
	});

	test("sums multiple lines including bulk-discounted ones", () => {
		const result = priceCart([
			{ unitCents: 100, quantity: 10 },
			{ unitCents: 250, quantity: 2 },
		]);
		assert.equal(result.subtotal, 1450);
	});

	test("SAVE10 takes 10 percent off and is reported in upper case", () => {
		assert.deepEqual(priceCart([{ unitCents: 1000, quantity: 1 }], "SAVE10"), {
			subtotal: 1000,
			discount: 100,
			shipping: 499,
			tax: 74,
			total: 1473,
			coupon: "SAVE10",
		});
	});

	test("coupon codes are case-insensitive and trimmed", () => {
		const result = priceCart([{ unitCents: 1000, quantity: 1 }], "  save10 ");
		assert.equal(result.coupon, "SAVE10");
		assert.equal(result.discount, 100);
	});

	test("free shipping is judged on the discounted amount", () => {
		assert.deepEqual(priceCart([{ unitCents: 5000, quantity: 1 }], "SAVE10"), {
			subtotal: 5000,
			discount: 500,
			shipping: 499,
			tax: 371,
			total: 5370,
			coupon: "SAVE10",
		});
	});

	test("SAVE10 applies to an empty cart with no effect", () => {
		assert.deepEqual(priceCart([], "SAVE10"), { subtotal: 0, discount: 0, shipping: 0, tax: 0, total: 0, coupon: "SAVE10" });
	});

	test("FLAT500 applies at its minimum subtotal", () => {
		assert.deepEqual(priceCart([{ unitCents: 2000, quantity: 1 }], "flat500"), {
			subtotal: 2000,
			discount: 500,
			shipping: 499,
			tax: 124,
			total: 2123,
			coupon: "FLAT500",
		});
	});

	test("FLAT500 is ignored below its minimum subtotal", () => {
		const result = priceCart([{ unitCents: 1999, quantity: 1 }], "FLAT500");
		assert.equal(result.coupon, null);
		assert.equal(result.discount, 0);
		assert.equal(result.total, 1999 + 499 + 165);
	});

	test("FREESHIP waives shipping at its minimum without a discount", () => {
		assert.deepEqual(priceCart([{ unitCents: 1000, quantity: 1 }], "FREESHIP"), {
			subtotal: 1000,
			discount: 0,
			shipping: 0,
			tax: 83,
			total: 1083,
			coupon: "FREESHIP",
		});
	});

	test("FREESHIP is ignored below its minimum subtotal", () => {
		const result = priceCart([{ unitCents: 999, quantity: 1 }], "FREESHIP");
		assert.equal(result.coupon, null);
		assert.equal(result.shipping, 499);
	});

	test("unknown, empty and missing coupons are ignored", () => {
		for (const code of ["BOGUS", "", undefined, null]) {
			const result = priceCart([{ unitCents: 1000, quantity: 1 }], code);
			assert.equal(result.coupon, null, `code ${String(code)}`);
			assert.equal(result.discount, 0);
			assert.equal(result.total, 1582);
		}
	});

	test("total always equals subtotal - discount + shipping + tax", () => {
		const carts = [
			[[{ unitCents: 1234, quantity: 3 }], "SAVE10"],
			[[{ unitCents: 777, quantity: 11 }], "FLAT500"],
			[[{ unitCents: 450, quantity: 4 }], "FREESHIP"],
			[[{ unitCents: 1, quantity: 1 }], undefined],
		];
		for (const [lines, code] of carts) {
			const r = priceCart(lines, code);
			assert.equal(r.total, r.subtotal - r.discount + r.shipping + r.tax);
		}
	});

	test("propagates RangeError from an invalid line", () => {
		assert.throws(
			() =>
				priceCart([
					{ unitCents: 100, quantity: 1 },
					{ unitCents: 100, quantity: -2 },
				]),
			RangeError,
		);
	});
});
