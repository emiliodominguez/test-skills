import { test } from "node:test";
import assert from "node:assert/strict";
import { createRefunds, REFUND_WINDOW_DAYS, RESTOCKING_PERCENT } from "./refunds.mjs";

const DAY = 86_400_000;
const DELIVERED_AT = "2026-01-01T00:00:00.000Z";

function makeOrder(overrides = {}) {
	return {
		id: "o1",
		status: "delivered",
		deliveredAt: DELIVERED_AT,
		paymentId: "pay_1",
		lines: [
			{ id: "a", cents: 1000, refunded: false },
			{ id: "b", cents: 2500, refunded: false },
			{ id: "c", cents: 333, refunded: false },
		],
		...overrides,
	};
}

function setup({ order = makeOrder(), daysAfter = 1, gatewayError = null } = {}) {
	const saved = [];
	const gatewayCalls = [];
	const deps = {
		orders: {
			async find(id) {
				return order && id === order.id ? order : null;
			},
			async save(o) {
				saved.push(structuredClone(o));
			},
		},
		gateway: {
			async refund(paymentId, cents, key) {
				gatewayCalls.push({ paymentId, cents, key });
				if (gatewayError) throw gatewayError;
				return { id: `rf_${gatewayCalls.length}` };
			},
		},
		clock: {
			now() {
				return new Date(new Date(DELIVERED_AT).getTime() + daysAfter * DAY);
			},
		},
	};
	return { service: createRefunds(deps), order, saved, gatewayCalls };
}

test("exports the expected constants", () => {
	assert.equal(REFUND_WINDOW_DAYS, 30);
	assert.equal(RESTOCKING_PERCENT, 15);
});

test("returns not-found for an unknown order", async () => {
	const { service, gatewayCalls, saved } = setup();
	const result = await service.refund("missing", { lineIds: ["a"], opened: false });
	assert.deepEqual(result, { ok: false, reason: "not-found" });
	assert.equal(gatewayCalls.length, 0);
	assert.equal(saved.length, 0);
});

test("returns not-delivered when the order is not delivered", async () => {
	const { service, gatewayCalls, saved } = setup({ order: makeOrder({ status: "shipped" }) });
	const result = await service.refund("o1", { lineIds: ["a"], opened: false });
	assert.deepEqual(result, { ok: false, reason: "not-delivered" });
	assert.equal(gatewayCalls.length, 0);
	assert.equal(saved.length, 0);
});

test("allows a refund exactly at the end of the window", async () => {
	const { service } = setup({ daysAfter: REFUND_WINDOW_DAYS });
	const result = await service.refund("o1", { lineIds: ["a"], opened: false });
	assert.equal(result.ok, true);
});

test("returns window-closed just after the window ends", async () => {
	const { service, gatewayCalls, saved } = setup({ daysAfter: REFUND_WINDOW_DAYS + 1 / 86_400_000 });
	const result = await service.refund("o1", { lineIds: ["a"], opened: false });
	assert.deepEqual(result, { ok: false, reason: "window-closed" });
	assert.equal(gatewayCalls.length, 0);
	assert.equal(saved.length, 0);
});

test("returns nothing-to-refund when no requested line exists", async () => {
	const { service, gatewayCalls, saved } = setup();
	const result = await service.refund("o1", { lineIds: ["zzz"], opened: false });
	assert.deepEqual(result, { ok: false, reason: "nothing-to-refund" });
	assert.equal(gatewayCalls.length, 0);
	assert.equal(saved.length, 0);
});

test("returns nothing-to-refund for an empty request", async () => {
	const { service } = setup();
	const result = await service.refund("o1", { lineIds: [], opened: false });
	assert.deepEqual(result, { ok: false, reason: "nothing-to-refund" });
});

test("returns nothing-to-refund when requested lines are already refunded", async () => {
	const order = makeOrder();
	order.lines[0].refunded = true;
	const { service, gatewayCalls } = setup({ order });
	const result = await service.refund("o1", { lineIds: ["a"], opened: false });
	assert.deepEqual(result, { ok: false, reason: "nothing-to-refund" });
	assert.equal(gatewayCalls.length, 0);
});

test("refunds the full amount for unopened items", async () => {
	const { service, gatewayCalls } = setup();
	const result = await service.refund("o1", { lineIds: ["a", "b"], opened: false });
	assert.deepEqual(result, { ok: true, refundId: "rf_1", cents: 3500 });
	assert.equal(gatewayCalls.length, 1);
	assert.equal(gatewayCalls[0].paymentId, "pay_1");
	assert.equal(gatewayCalls[0].cents, 3500);
});

test("deducts a restocking fee for opened items", async () => {
	const { service, gatewayCalls } = setup();
	const result = await service.refund("o1", { lineIds: ["a", "b"], opened: true });
	// fee = 15% of 3500 = 525
	assert.deepEqual(result, { ok: true, refundId: "rf_1", cents: 2975 });
	assert.equal(gatewayCalls[0].cents, 2975);
});

test("rounds the restocking fee to the nearest cent", async () => {
	const { service } = setup();
	// 15% of 333 = 49.95 -> 50, refund 283
	const result = await service.refund("o1", { lineIds: ["c"], opened: true });
	assert.equal(result.cents, 283);
	assert.ok(Number.isInteger(result.cents));
});

test("ignores unknown line ids mixed with valid ones", async () => {
	const { service } = setup();
	const result = await service.refund("o1", { lineIds: ["a", "nope"], opened: false });
	assert.deepEqual(result, { ok: true, refundId: "rf_1", cents: 1000 });
});

test("skips already-refunded lines and refunds the rest", async () => {
	const order = makeOrder();
	order.lines[0].refunded = true;
	const { service, gatewayCalls } = setup({ order });
	const result = await service.refund("o1", { lineIds: ["a", "b"], opened: false });
	assert.deepEqual(result, { ok: true, refundId: "rf_1", cents: 2500 });
	assert.equal(gatewayCalls[0].key, "o1:b");
});

test("counts duplicate requested ids only once", async () => {
	const { service } = setup();
	const result = await service.refund("o1", { lineIds: ["a", "a"], opened: false });
	assert.equal(result.cents, 1000);
});

test("builds an idempotency key from the order id and sorted line ids", async () => {
	const { service, gatewayCalls } = setup();
	await service.refund("o1", { lineIds: ["c", "a"], opened: false });
	assert.equal(gatewayCalls[0].key, "o1:a,c");
});

test("idempotency key does not depend on request order", async () => {
	const first = setup();
	const second = setup();
	await first.service.refund("o1", { lineIds: ["b", "a"], opened: false });
	await second.service.refund("o1", { lineIds: ["a", "b"], opened: false });
	assert.equal(first.gatewayCalls[0].key, second.gatewayCalls[0].key);
});

test("marks refunded lines and saves the order", async () => {
	const { service, saved } = setup();
	await service.refund("o1", { lineIds: ["a", "c"], opened: false });
	assert.equal(saved.length, 1);
	const refundedFlags = Object.fromEntries(saved[0].lines.map((l) => [l.id, l.refunded]));
	assert.deepEqual(refundedFlags, { a: true, b: false, c: true });
});

test("a second refund of the same lines is rejected", async () => {
	const { service, gatewayCalls } = setup();
	const first = await service.refund("o1", { lineIds: ["a"], opened: false });
	const second = await service.refund("o1", { lineIds: ["a"], opened: false });
	assert.equal(first.ok, true);
	assert.deepEqual(second, { ok: false, reason: "nothing-to-refund" });
	assert.equal(gatewayCalls.length, 1);
});

test("propagates gateway errors without marking lines or saving", async () => {
	const { service, order, saved } = setup({ gatewayError: new Error("gateway down") });
	await assert.rejects(service.refund("o1", { lineIds: ["a"], opened: false }), /gateway down/);
	assert.equal(saved.length, 0);
	assert.equal(order.lines[0].refunded, false);
});

test("calls the gateway before saving the order", async () => {
	const events = [];
	const order = makeOrder();
	const service = createRefunds({
		orders: {
			async find() {
				return order;
			},
			async save() {
				events.push("save");
			},
		},
		gateway: {
			async refund() {
				events.push("gateway");
				return { id: "rf_x" };
			},
		},
		clock: { now: () => new Date(new Date(DELIVERED_AT).getTime() + DAY) },
	});
	const result = await service.refund("o1", { lineIds: ["a"], opened: false });
	assert.deepEqual(events, ["gateway", "save"]);
	assert.equal(result.refundId, "rf_x");
});
