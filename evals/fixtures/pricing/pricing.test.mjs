import assert from "node:assert/strict";
import { test } from "node:test";
import { priceCart } from "./pricing.mjs";

test("prices a simple cart", function simple() {
	assert.equal(priceCart([{ unitCents: 1000, quantity: 1 }]).total, 1000 + 499 + 83);
});
