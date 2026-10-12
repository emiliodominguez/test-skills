import { test, describe } from "node:test";
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
			{ id: "c", cents: 499, refunded: false },
		],
		...overrides,
	};
}

function setup({ order = makeOrder(), now = new Date(Date.parse(DELIVERED_AT) + 5 * DAY), gatewayImpl } = {}) {
	const calls = { find: [], save: [], refund: [] };
	const store = new Map();
	if (order) store.set(order.id, order);
	const deps = {
		orders: {
			async find(id) {
				calls.find.push(id);
				return store.get(id);
			},
			async save(o) {
				calls.save.push(structuredClone(o));
			},
		},
		gateway: {
			async refund(paymentId, cents, key) {
				calls.refund.push({ paymentId, cents, key });
				if (gatewayImpl) return gatewayImpl(paymentId, cents, key);
				return { id: `r_${calls.refund.length}` };
			},
		},
		clock: { now: () => now },
	};
	return { service: createRefunds(deps), calls, order };
}

describe("constants", () => {
	test("exports the refund window and restocking percentage", () => {
		assert.equal(REFUND_WINDOW_DAYS, 30);
		assert.equal(RESTOCKING_PERCENT, 15);
	});
});

describe("refusals", () => {
	test("unknown order returns not-found and touches nothing", async () => {
		const { service, calls } = setup();
		const out = await service.refund("missing", { lineIds: ["a"], opened: false });
		assert.deepEqual(out, { ok: false, reason: "not-found" });
		assert.deepEqual(calls.find, ["missing"]);
		assert.equal(calls.refund.length, 0);
		assert.equal(calls.save.length, 0);
	});

	for (const status of ["pending", "shipped", "cancelled"]) {
		test(`order with status ${status} returns not-delivered`, async () => {
			const { service, calls } = setup({ order: makeOrder({ status }) });
			const out = await service.refund("o1", { lineIds: ["a"], opened: false });
			assert.deepEqual(out, { ok: false, reason: "not-delivered" });
			assert.equal(calls.refund.length, 0);
			assert.equal(calls.save.length, 0);
		});
	}

	test("refund after the window returns window-closed", async () => {
		const now = new Date(Date.parse(DELIVERED_AT) + 30 * DAY + 1);
		const { service, calls } = setup({ now });
		const out = await service.refund("o1", { lineIds: ["a"], opened: false });
		assert.deepEqual(out, { ok: false, reason: "window-closed" });
		assert.equal(calls.refund.length, 0);
		assert.equal(calls.save.length, 0);
	});

	test("no requested line ids returns nothing-to-refund", async () => {
		const { service, calls } = setup();
		const out = await service.refund("o1", { lineIds: [], opened: false });
		assert.deepEqual(out, { ok: false, reason: "nothing-to-refund" });
		assert.equal(calls.refund.length, 0);
		assert.equal(calls.save.length, 0);
	});

	test("unknown line ids return nothing-to-refund", async () => {
		const { service } = setup();
		const out = await service.refund("o1", { lineIds: ["zzz"], opened: false });
		assert.deepEqual(out, { ok: false, reason: "nothing-to-refund" });
	});

	test("already refunded lines return nothing-to-refund", async () => {
		const order = makeOrder();
		order.lines[0].refunded = true;
		const { service, calls } = setup({ order });
		const out = await service.refund("o1", { lineIds: ["a"], opened: false });
		assert.deepEqual(out, { ok: false, reason: "nothing-to-refund" });
		assert.equal(calls.refund.length, 0);
	});

	test("not-delivered is checked before the window", async () => {
		const now = new Date(Date.parse(DELIVERED_AT) + 100 * DAY);
		const { service } = setup({ order: makeOrder({ status: "shipped" }), now });
		const out = await service.refund("o1", { lineIds: ["a"], opened: false });
		assert.equal(out.reason, "not-delivered");
	});
});

describe("refund window boundary", () => {
	test("exactly 30 days after delivery is still allowed", async () => {
		const now = new Date(Date.parse(DELIVERED_AT) + 30 * DAY);
		const { service } = setup({ now });
		const out = await service.refund("o1", { lineIds: ["a"], opened: false });
		assert.equal(out.ok, true);
	});

	test("same instant as delivery is allowed", async () => {
		const { service } = setup({ now: new Date(DELIVERED_AT) });
		const out = await service.refund("o1", { lineIds: ["a"], opened: false });
		assert.equal(out.ok, true);
	});
});

describe("successful refunds", () => {
	test("unopened single line refunds full amount", async () => {
		const { service, calls } = setup();
		const out = await service.refund("o1", { lineIds: ["a"], opened: false });
		assert.deepEqual(out, { ok: true, refundId: "r_1", cents: 1000 });
		assert.deepEqual(calls.refund, [{ paymentId: "pay_1", cents: 1000, key: "o1:a" }]);
	});

	test("multiple lines are summed", async () => {
		const { service, calls } = setup();
		const out = await service.refund("o1", { lineIds: ["a", "b"], opened: false });
		assert.equal(out.cents, 3500);
		assert.equal(calls.refund[0].cents, 3500);
	});

	test("opened items are charged a 15% restocking fee", async () => {
		const { service, calls } = setup();
		const out = await service.refund("o1", { lineIds: ["a", "b"], opened: true });
		assert.equal(out.cents, 3500 - 525);
		assert.equal(calls.refund[0].cents, 2975);
	});

	test("restocking fee is rounded to the nearest cent (half up)", async () => {
		const order = makeOrder({ lines: [{ id: "x", cents: 10, refunded: false }] });
		const { service } = setup({ order });
		// 10 * 15% = 1.5 -> fee 2
		const out = await service.refund("o1", { lineIds: ["x"], opened: true });
		assert.equal(out.cents, 8);
	});

	test("restocking fee rounds down below half a cent", async () => {
		const { service } = setup();
		// 499 * 15% = 74.85 -> fee 75; 1003 test below covers rounding down
		const out = await service.refund("o1", { lineIds: ["c"], opened: true });
		assert.equal(out.cents, 499 - 75);

		const order2 = makeOrder({ lines: [{ id: "y", cents: 1003, refunded: false }] });
		const s2 = setup({ order: order2 });
		// 1003 * 15% = 150.45 -> fee 150
		const out2 = await s2.service.refund("o1", { lineIds: ["y"], opened: true });
		assert.equal(out2.cents, 853);
	});

	test("idempotency key uses sorted line ids regardless of request order", async () => {
		const { service, calls } = setup();
		await service.refund("o1", { lineIds: ["c", "a", "b"], opened: false });
		assert.equal(calls.refund[0].key, "o1:a,b,c");
	});

	test("already refunded lines are skipped and excluded from amount and key", async () => {
		const order = makeOrder();
		order.lines[1].refunded = true;
		const { service, calls } = setup({ order });
		const out = await service.refund("o1", { lineIds: ["a", "b"], opened: false });
		assert.equal(out.cents, 1000);
		assert.equal(calls.refund[0].key, "o1:a");
	});

	test("unknown line ids mixed with valid ones are ignored", async () => {
		const { service, calls } = setup();
		const out = await service.refund("o1", { lineIds: ["a", "nope"], opened: false });
		assert.equal(out.cents, 1000);
		assert.equal(calls.refund[0].key, "o1:a");
	});

	test("refunded lines are marked and the order is saved once", async () => {
		const { service, calls, order } = setup();
		await service.refund("o1", { lineIds: ["a", "c"], opened: false });
		assert.equal(calls.save.length, 1);
		const saved = calls.save[0];
		assert.deepEqual(
			saved.lines.map((l) => [l.id, l.refunded]),
			[
				["a", true],
				["b", false],
				["c", true],
			],
		);
		assert.equal(order.lines[0].refunded, true);
		assert.equal(order.lines[1].refunded, false);
	});

	test("refunding the same lines twice refuses the second time", async () => {
		const { service, calls } = setup();
		const first = await service.refund("o1", { lineIds: ["a"], opened: false });
		assert.equal(first.ok, true);
		const second = await service.refund("o1", { lineIds: ["a"], opened: false });
		assert.deepEqual(second, { ok: false, reason: "nothing-to-refund" });
		assert.equal(calls.refund.length, 1);
	});

	test("partial refunds can follow each other on remaining lines", async () => {
		const { service, calls } = setup();
		await service.refund("o1", { lineIds: ["a"], opened: false });
		const out = await service.refund("o1", { lineIds: ["a", "b"], opened: false });
		assert.deepEqual(out, { ok: true, refundId: "r_2", cents: 2500 });
		assert.equal(calls.refund[1].key, "o1:b");
	});

	test("returns the gateway's refund id", async () => {
		const { service } = setup({ gatewayImpl: () => ({ id: "gw_xyz" }) });
		const out = await service.refund("o1", { lineIds: ["a"], opened: false });
		assert.equal(out.refundId, "gw_xyz");
	});
});

describe("gateway failure", () => {
	test("propagates the error and does not mark or save lines", async () => {
		const { service, calls, order } = setup({
			gatewayImpl: () => {
				throw new Error("gateway down");
			},
		});
		await assert.rejects(service.refund("o1", { lineIds: ["a"], opened: false }), /gateway down/);
		assert.equal(calls.save.length, 0);
		assert.equal(order.lines[0].refunded, false);
	});
});
