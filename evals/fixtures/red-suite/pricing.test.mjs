import assert from "node:assert/strict";
import { test } from "node:test";
import { lineAmount, priceCart } from "./pricing.mjs";

test("a single line below free shipping pays the fee and tax", function smallOrder() {
	assert.deepEqual(priceCart([{ unitCents: 1000, quantity: 1 }]), {
		subtotal: 1000,
		discount: 0,
		shipping: 499,
		tax: 83,
		total: 1582,
		coupon: null,
	});
});

test("ten or more units get the bulk discount, rounded half up", function bulk() {
	assert.equal(lineAmount({ unitCents: 999, quantity: 10 }), 9490);
});

test("orders from 5000 ship free", function freeShipping() {
	assert.equal(priceCart([{ unitCents: 5000, quantity: 1 }]).shipping, 0);
	assert.equal(priceCart([{ unitCents: 4999, quantity: 1 }]).shipping, 499);
});

test("SAVE10 takes ten percent before tax", function percentCoupon() {
	assert.deepEqual(priceCart([{ unitCents: 2000, quantity: 1 }], "save10"), {
		subtotal: 2000,
		discount: 200,
		shipping: 499,
		tax: 149,
		total: 2448,
		coupon: "SAVE10",
	});
});
