import assert from "node:assert/strict";
import { test } from "node:test";
import { invoice } from "./billing.mjs";

test("bills a team plan monthly in USD", function teamMonthly() {
	assert.equal(invoice({ plan: "team", seats: 5, interval: "month", currency: "USD" }).total, 1500);
});
