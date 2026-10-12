import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
	BULK_QUANTITY,
	BULK_PERCENT,
	FREE_SHIPPING_FROM,
	SHIPPING_FEE,
	TAX_BASIS_POINTS,
	COUPONS,
	roundCents,
	lineAmount,
	priceCart,
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
	test("rounds halves up", () => {
		assert.equal(roundCents(2.5), 3);
		assert.equal(roundCents(15.5), 16);
	});

	test("rounds below half down and keeps integers", () => {
		assert.equal(roundCents(2.49), 2);
		assert.equal(roundCents(2.51), 3);
		assert.equal(roundCents(0), 0);
		assert.equal(roundCents(42), 42);
	});
});

describe("lineAmount", () => {
	test("multiplies price by quantity below the bulk threshold", () => {
		assert.equal(lineAmount({ unitCents: 100, quantity: 9 }), 900);
		assert.equal(lineAmount({ unitCents: 250, quantity: 1 }), 250);
	});

	test("zero quantity or zero price gives zero", () => {
		assert.equal(lineAmount({ unitCents: 100, quantity: 0 }), 0);
		assert.equal(lineAmount({ unitCents: 0, quantity: 20 }), 0);
	});

	test("applies the bulk discount at exactly the threshold", () => {
		assert.equal(lineAmount({ unitCents: 100, quantity: 10 }), 950);
	});

	test("applies the bulk discount above the threshold", () => {
		assert.equal(lineAmount({ unitCents: 200, quantity: 25 }), 4750);
	});

	test("rounds the bulk discount half up", () => {
		// gross 330, discount 16.5 -> 17
		assert.equal(lineAmount({ unitCents: 33, quantity: 10 }), 313);
		// gross 310, discount 15.5 -> 16
		assert.equal(lineAmount({ unitCents: 31, quantity: 10 }), 294);
		// gross 320, discount 16 exactly
		assert.equal(lineAmount({ unitCents: 32, quantity: 10 }), 304);
	});

	test("rejects non-integer or negative quantities", () => {
		assert.throws(() => lineAmount({ unitCents: 100, quantity: 1.5 }), RangeError);
		assert.throws(() => lineAmount({ unitCents: 100, quantity: -1 }), RangeError);
		assert.throws(() => lineAmount({ unitCents: 100, quantity: NaN }), RangeError);
		assert.throws(() => lineAmount({ unitCents: 100, quantity: "2" }), RangeError);
	});

	test("rejects non-integer or negative prices", () => {
		assert.throws(() => lineAmount({ unitCents: 9.99, quantity: 1 }), RangeError);
		assert.throws(() => lineAmount({ unitCents: -1, quantity: 1 }), RangeError);
		assert.throws(() => lineAmount({ unitCents: undefined, quantity: 1 }), RangeError);
	});

	test("error messages identify the bad field", () => {
		assert.throws(() => lineAmount({ unitCents: 1, quantity: -1 }), /quantity/);
		assert.throws(() => lineAmount({ unitCents: -1, quantity: 1 }), /unit price/);
	});
});

describe("priceCart", () => {
	test("empty cart is all zeros with no shipping", () => {
		assert.deepEqual(priceCart([]), { subtotal: 0, discount: 0, shipping: 0, tax: 0, total: 0, coupon: null });
	});

	test("cart of zero-value lines ships free", () => {
		const result = priceCart([{ unitCents: 0, quantity: 3 }]);
		assert.equal(result.shipping, 0);
		assert.equal(result.total, 0);
	});

	test("small order pays shipping and tax", () => {
		// tax 82.5 -> 83
		assert.deepEqual(priceCart([{ unitCents: 1000, quantity: 1 }]), {
			subtotal: 1000,
			discount: 0,
			shipping: 499,
			tax: 83,
			total: 1582,
			coupon: null,
		});
	});

	test("sums multiple lines including bulk discounts", () => {
		const result = priceCart([
			{ unitCents: 100, quantity: 10 },
			{ unitCents: 250, quantity: 2 },
		]);
		assert.equal(result.subtotal, 950 + 500);
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

	test("charges shipping one cent below the threshold", () => {
		const result = priceCart([{ unitCents: 4999, quantity: 1 }]);
		assert.equal(result.shipping, SHIPPING_FEE);
		assert.equal(result.tax, 412);
		assert.equal(result.total, 4999 + 499 + 412);
	});

	test("total always equals subtotal - discount + shipping + tax", () => {
		const carts = [
			[[1234, 3]],
			[
				[33, 10],
				[999, 4],
			],
			[[5000, 2]],
		];
		for (const cart of carts) {
			for (const code of [undefined, "SAVE10", "FLAT500", "FREESHIP"]) {
				const r = priceCart(
					cart.map(([unitCents, quantity]) => ({ unitCents, quantity })),
					code,
				);
				assert.equal(r.total, r.subtotal - r.discount + r.shipping + r.tax);
			}
		}
	});

	describe("coupons", () => {
		test("SAVE10 takes 10 percent off and taxes the discounted amount", () => {
			assert.deepEqual(priceCart([{ unitCents: 1000, quantity: 1 }], "SAVE10"), {
				subtotal: 1000,
				discount: 100,
				shipping: 499,
				tax: 74,
				total: 1473,
				coupon: "SAVE10",
			});
		});

		test("SAVE10 rounds the discount half up", () => {
			// 10% of 1005 = 100.5 -> 101
			assert.equal(priceCart([{ unitCents: 1005, quantity: 1 }], "SAVE10").discount, 101);
		});

		test("discount can push the order below free shipping", () => {
			const result = priceCart([{ unitCents: 5000, quantity: 1 }], "SAVE10");
			assert.equal(result.discount, 500);
			assert.equal(result.shipping, SHIPPING_FEE);
			assert.equal(result.tax, 371);
			assert.equal(result.total, 4500 + 499 + 371);
		});

		test("coupon codes are case-insensitive and trimmed", () => {
			const result = priceCart([{ unitCents: 1000, quantity: 1 }], "  save10 ");
			assert.equal(result.coupon, "SAVE10");
			assert.equal(result.discount, 100);
		});

		test("SAVE10 applies to an empty cart with no effect", () => {
			const result = priceCart([], "SAVE10");
			assert.equal(result.coupon, "SAVE10");
			assert.equal(result.discount, 0);
			assert.equal(result.total, 0);
		});

		test("FLAT500 applies at its minimum", () => {
			assert.deepEqual(priceCart([{ unitCents: 2000, quantity: 1 }], "FLAT500"), {
				subtotal: 2000,
				discount: 500,
				shipping: 499,
				tax: 124,
				total: 2123,
				coupon: "FLAT500",
			});
		});

		test("FLAT500 is ignored below its minimum", () => {
			const result = priceCart([{ unitCents: 1999, quantity: 1 }], "FLAT500");
			assert.equal(result.coupon, null);
			assert.equal(result.discount, 0);
		});

		test("FREESHIP waives shipping at its minimum", () => {
			assert.deepEqual(priceCart([{ unitCents: 1000, quantity: 1 }], "FREESHIP"), {
				subtotal: 1000,
				discount: 0,
				shipping: 0,
				tax: 83,
				total: 1083,
				coupon: "FREESHIP",
			});
		});

		test("FREESHIP is ignored below its minimum", () => {
			const result = priceCart([{ unitCents: 999, quantity: 1 }], "FREESHIP");
			assert.equal(result.coupon, null);
			assert.equal(result.shipping, SHIPPING_FEE);
		});

		test("minimum is checked against the bulk-discounted subtotal", () => {
			// gross 2100, bulk discount 105 -> subtotal 1995, below FLAT500 minimum
			const result = priceCart([{ unitCents: 210, quantity: 10 }], "FLAT500");
			assert.equal(result.subtotal, 1995);
			assert.equal(result.coupon, null);
		});

		test("unknown, empty and missing codes apply nothing", () => {
			const lines = [{ unitCents: 3000, quantity: 1 }];
			for (const code of ["BOGUS", "", undefined, null]) {
				const result = priceCart(lines, code);
				assert.equal(result.coupon, null);
				assert.equal(result.discount, 0);
			}
		});

		test("inherited object keys are not coupons", () => {
			const result = priceCart([{ unitCents: 3000, quantity: 1 }], "toString");
			assert.equal(result.discount, 0);
		});
	});

	test("propagates invalid line errors", () => {
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
