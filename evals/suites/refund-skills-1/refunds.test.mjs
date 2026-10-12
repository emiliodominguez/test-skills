// Tests for the refund service. Expected values are computed by hand from the business rules
// (30-day window, 15% restocking fee rounded to the nearest cent), never from the module's output.
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { createRefunds } from "./refunds.mjs";

const DAY_MS = 86_400_000;
const NOW = new Date("2026-03-31T12:00:00.000Z");

/**
 * In-memory order store that copies on read and write, like a real database: changes made to a
 * found order are invisible until `save` is called.
 *
 * @param {any[]} orders - Seed orders.
 * @returns {{ find(id: string): Promise<any>, save(order: any): Promise<void>, peek(id: string): any, saves: any[] }} Store.
 */
function memoryOrders(orders) {
	const rows = new Map(
		orders.map(function byId(order) {
			return [order.id, structuredClone(order)];
		}),
	);
	const saves = [];

	return {
		saves,
		/**
		 * Find an order by id.
		 *
		 * @param {string} id - Order id.
		 * @returns {Promise<any>} A copy of the order, or undefined.
		 */
		async find(id) {
			const row = rows.get(id);

			return row === undefined ? undefined : structuredClone(row);
		},
		/**
		 * Persist an order.
		 *
		 * @param {any} order - Order to store.
		 * @returns {Promise<void>}
		 */
		async save(order) {
			saves.push(structuredClone(order));
			rows.set(order.id, structuredClone(order));
		},
		/**
		 * Read the stored state of an order for assertions.
		 *
		 * @param {string} id - Order id.
		 * @returns {any} Stored copy.
		 */
		peek(id) {
			return structuredClone(rows.get(id));
		},
	};
}

/**
 * Payment gateway fake that records every refund call and returns sequential ids. It can be
 * told to fail by name.
 *
 * @param {{ failWith?: "refused" }} [options] - Named failure mode.
 * @returns {{ refund(paymentId: string, cents: number, key: string): Promise<{ id: string }>, calls: any[] }} Gateway.
 */
function fakeGateway(options = {}) {
	const calls = [];

	return {
		calls,
		/**
		 * Issue a refund.
		 *
		 * @param {string} paymentId - Payment to refund.
		 * @param {number} cents - Amount in cents.
		 * @param {string} key - Idempotency key.
		 * @returns {Promise<{ id: string }>} Gateway refund id.
		 */
		async refund(paymentId, cents, key) {
			calls.push({ paymentId, cents, key });
			if (options.failWith === "refused") throw new Error("gateway: refused");

			return { id: `rf_${calls.length}` };
		},
	};
}

/**
 * Clock fixed at a given instant.
 *
 * @param {Date} at - The instant to report.
 * @returns {{ now(): Date }} Clock.
 */
function fixedClock(at) {
	return {
		/**
		 * Current time.
		 *
		 * @returns {Date} A fresh copy of the fixed instant.
		 */
		now() {
			return new Date(at.getTime());
		},
	};
}

/**
 * A delivered order with three lines, delivered `ageMs` before NOW.
 *
 * @param {Partial<any>} [overrides] - Fields to replace.
 * @param {number} [ageMs] - Time since delivery, in milliseconds.
 * @returns {any} Order.
 */
function deliveredOrder(overrides = {}, ageMs = 5 * DAY_MS) {
	return {
		id: "ord_1",
		status: "delivered",
		deliveredAt: new Date(NOW.getTime() - ageMs).toISOString(),
		paymentId: "pay_1",
		// Lines are deliberately not in id order, so the idempotency key must sort them.
		lines: [
			{ id: "l3", cents: 1000, refunded: false },
			{ id: "l1", cents: 2500, refunded: false },
			{ id: "l2", cents: 10, refunded: false },
		],
		...overrides,
	};
}

/**
 * Build a service around fresh fakes.
 *
 * @param {any[]} orders - Seed orders.
 * @param {{ failWith?: "refused" }} [gatewayOptions] - Gateway failure mode.
 * @returns {{ service: ReturnType<typeof createRefunds>, orders: ReturnType<typeof memoryOrders>, gateway: ReturnType<typeof fakeGateway> }} Harness.
 */
function harness(orders, gatewayOptions) {
	const store = memoryOrders(orders);
	const gateway = fakeGateway(gatewayOptions);
	const service = createRefunds({ orders: store, gateway, clock: fixedClock(NOW) });

	return { service, orders: store, gateway };
}

describe("refund refusals", function refusals() {
	const cases = [
		{ name: "unknown order", orders: [], orderId: "ord_missing", lineIds: ["l1"], reason: "not-found" },
		{
			name: "order not yet delivered",
			orders: [deliveredOrder({ status: "shipped" })],
			orderId: "ord_1",
			lineIds: ["l1"],
			reason: "not-delivered",
		},
		{ name: "order cancelled", orders: [deliveredOrder({ status: "cancelled" })], orderId: "ord_1", lineIds: ["l1"], reason: "not-delivered" },
		{
			name: "one millisecond past the 30-day window",
			orders: [deliveredOrder({}, 30 * DAY_MS + 1)],
			orderId: "ord_1",
			lineIds: ["l1"],
			reason: "window-closed",
		},
		{ name: "31 days after delivery", orders: [deliveredOrder({}, 31 * DAY_MS)], orderId: "ord_1", lineIds: ["l1"], reason: "window-closed" },
		{ name: "no requested lines", orders: [deliveredOrder()], orderId: "ord_1", lineIds: [], reason: "nothing-to-refund" },
		{ name: "line ids not on the order", orders: [deliveredOrder()], orderId: "ord_1", lineIds: ["l9"], reason: "nothing-to-refund" },
		{
			name: "every requested line already refunded",
			orders: [
				deliveredOrder({
					lines: [
						{ id: "l1", cents: 2500, refunded: true },
						{ id: "l2", cents: 10, refunded: false },
					],
				}),
			],
			orderId: "ord_1",
			lineIds: ["l1"],
			reason: "nothing-to-refund",
		},
	];

	for (const testCase of cases) {
		test(`${testCase.name} is refused as ${testCase.reason} without charging or saving`, async function refused() {
			const { service, orders, gateway } = harness(testCase.orders);

			const outcome = await service.refund(testCase.orderId, { lineIds: testCase.lineIds, opened: false });

			assert.deepEqual(outcome, { ok: false, reason: testCase.reason });
			assert.deepEqual(gateway.calls, []);
			assert.deepEqual(orders.saves, []);
		});
	}
});

describe("refund window boundary", function windowBoundary() {
	const allowed = [
		{ name: "on the delivery instant", ageMs: 0 },
		{ name: "exactly 30 days after delivery", ageMs: 30 * DAY_MS },
		{ name: "one millisecond before the window closes", ageMs: 30 * DAY_MS - 1 },
	];

	for (const testCase of allowed) {
		test(`a refund ${testCase.name} is accepted`, async function accepted() {
			const { service } = harness([deliveredOrder({}, testCase.ageMs)]);

			const outcome = await service.refund("ord_1", { lineIds: ["l1"], opened: false });

			assert.deepEqual(outcome, { ok: true, refundId: "rf_1", cents: 2500 });
		});
	}
});

describe("refund amount", function amount() {
	// gross = sum of requested, not-yet-refunded lines; fee = round(gross * 15 / 100) when opened.
	const cases = [
		{ name: "one unopened line is refunded in full", lineIds: ["l1"], opened: false, cents: 2500 },
		{ name: "several unopened lines are summed", lineIds: ["l1", "l3"], opened: false, cents: 3500 },
		{ name: "opened items lose a 15% restocking fee", lineIds: ["l3"], opened: true, cents: 850 },
		{ name: "the fee is taken from the summed gross", lineIds: ["l1", "l3"], opened: true, cents: 2975 },
		// 1010 * 15 / 100 = 151.5, rounded to 152, so 1010 - 152 = 858 (floor would give 859).
		{ name: "a half-cent fee rounds up", lineIds: ["l3", "l2"], opened: true, cents: 858 },
		// 10 * 15 / 100 = 1.5, rounded to 2, so 8.
		{ name: "a tiny line still pays a rounded fee", lineIds: ["l2"], opened: true, cents: 8 },
		{ name: "unknown ids alongside known ones are ignored", lineIds: ["l9", "l1"], opened: false, cents: 2500 },
	];

	for (const testCase of cases) {
		test(testCase.name, async function charged() {
			const { service, gateway } = harness([deliveredOrder()]);

			const outcome = await service.refund("ord_1", { lineIds: testCase.lineIds, opened: testCase.opened });

			assert.deepEqual(outcome, { ok: true, refundId: "rf_1", cents: testCase.cents });
			assert.deepEqual(
				gateway.calls.map(function amountOf(call) {
					return call.cents;
				}),
				[testCase.cents],
			);
		});
	}

	test("a fee below half a cent rounds down", async function roundsDown() {
		// 1003 * 15 / 100 = 150.45, rounded to 150, so 1003 - 150 = 853 (ceil would give 852).
		const { service } = harness([deliveredOrder({ lines: [{ id: "l1", cents: 1003, refunded: false }] })]);

		const outcome = await service.refund("ord_1", { lineIds: ["l1"], opened: true });

		assert.deepEqual(outcome, { ok: true, refundId: "rf_1", cents: 853 });
	});

	test("lines already refunded are excluded from the amount", async function partiallyRefunded() {
		const order = deliveredOrder({
			lines: [
				{ id: "l1", cents: 2500, refunded: true },
				{ id: "l2", cents: 400, refunded: false },
			],
		});
		const { service, gateway } = harness([order]);

		const outcome = await service.refund("ord_1", { lineIds: ["l1", "l2"], opened: false });

		assert.deepEqual(outcome, { ok: true, refundId: "rf_1", cents: 400 });
		assert.deepEqual(gateway.calls, [{ paymentId: "pay_1", cents: 400, key: "ord_1:l2" }]);
	});
});

describe("gateway call", function gatewayCall() {
	test("charges the order's payment once with a sorted idempotency key", async function sortedKey() {
		const { service, gateway } = harness([deliveredOrder()]);

		await service.refund("ord_1", { lineIds: ["l2", "l3", "l1"], opened: false });

		assert.deepEqual(gateway.calls, [{ paymentId: "pay_1", cents: 3510, key: "ord_1:l1,l2,l3" }]);
	});

	test("the same lines requested in any order produce the same key", async function stableKey() {
		const requests = [
			["l3", "l1"],
			["l1", "l3"],
		];
		const keys = [];

		for (const lineIds of requests) {
			const { service, gateway } = harness([deliveredOrder()]);

			await service.refund("ord_1", { lineIds, opened: false });
			keys.push(gateway.calls[0].key);
		}

		assert.deepEqual(keys, ["ord_1:l1,l3", "ord_1:l1,l3"]);
	});

	test("returns the gateway's refund id", async function refundId() {
		const { service } = harness([deliveredOrder(), deliveredOrder({ id: "ord_2", paymentId: "pay_2" })]);

		const first = await service.refund("ord_1", { lineIds: ["l1"], opened: false });
		const second = await service.refund("ord_2", { lineIds: ["l1"], opened: false });

		assert.deepEqual(
			[first, second],
			[
				{ ok: true, refundId: "rf_1", cents: 2500 },
				{ ok: true, refundId: "rf_2", cents: 2500 },
			],
		);
	});
});

describe("persistence", function persistence() {
	test("marks exactly the refunded lines and saves the order", async function marksLines() {
		const { service, orders } = harness([deliveredOrder()]);

		await service.refund("ord_1", { lineIds: ["l1", "l2"], opened: false });

		assert.equal(orders.saves.length, 1);
		assert.deepEqual(orders.peek("ord_1").lines, [
			{ id: "l3", cents: 1000, refunded: false },
			{ id: "l1", cents: 2500, refunded: true },
			{ id: "l2", cents: 10, refunded: true },
		]);
	});

	test("refunding the same lines twice charges once and then refuses", async function noDoubleRefund() {
		const { service, gateway } = harness([deliveredOrder()]);

		const first = await service.refund("ord_1", { lineIds: ["l1"], opened: false });
		const second = await service.refund("ord_1", { lineIds: ["l1"], opened: false });

		assert.deepEqual(
			[first, second],
			[
				{ ok: true, refundId: "rf_1", cents: 2500 },
				{ ok: false, reason: "nothing-to-refund" },
			],
		);
		assert.equal(gateway.calls.length, 1);
	});

	test("a later refund of the remaining lines charges only those", async function remainingLines() {
		const { service, gateway } = harness([deliveredOrder()]);

		await service.refund("ord_1", { lineIds: ["l1"], opened: false });
		const second = await service.refund("ord_1", { lineIds: ["l1", "l3"], opened: false });

		assert.deepEqual(second, { ok: true, refundId: "rf_2", cents: 1000 });
		assert.deepEqual(gateway.calls[1], { paymentId: "pay_1", cents: 1000, key: "ord_1:l3" });
	});

	test("a refused gateway call propagates and leaves the order untouched", async function gatewayRefused() {
		const { service, orders } = harness([deliveredOrder()], { failWith: "refused" });

		await assert.rejects(service.refund("ord_1", { lineIds: ["l1"], opened: false }), { message: "gateway: refused" });

		assert.deepEqual(orders.saves, []);
		assert.deepEqual(orders.peek("ord_1"), deliveredOrder());
	});
});
