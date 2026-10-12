import { test } from "node:test";
import assert from "node:assert/strict";

import { createRefunds } from "./refunds.mjs";

const DAY_MS = 86_400_000;
const DELIVERED_AT = "2026-01-01T00:00:00.000Z";

/**
 * Build a delivered order with three lines (stored out of id order on purpose).
 *
 * @param {object} [overrides] - Fields to replace.
 * @returns {object} Order record.
 */
function makeOrder(overrides) {
	return {
		id: "ord-1",
		status: "delivered",
		deliveredAt: DELIVERED_AT,
		paymentId: "pay-1",
		lines: [
			{ id: "l3", cents: 3000, refunded: false },
			{ id: "l1", cents: 1000, refunded: false },
			{ id: "l2", cents: 2000, refunded: false },
		],
		...overrides,
	};
}

/**
 * In-memory order store that keeps its own copies, like a real database would.
 *
 * @param {object[]} orders - Seed orders.
 * @returns {{ find(id: string): Promise<any>, save(order: any): Promise<void>, saves: object[], get(id: string): any }} Store.
 */
function makeStore(orders) {
	const rows = new Map();

	for (const order of orders) rows.set(order.id, structuredClone(order));

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

			return row ? structuredClone(row) : undefined;
		},
		/**
		 * Persist an order.
		 *
		 * @param {any} order - Order to save.
		 * @returns {Promise<void>}
		 */
		async save(order) {
			saves.push(structuredClone(order));
			rows.set(order.id, structuredClone(order));
		},
		/**
		 * Read the stored row directly.
		 *
		 * @param {string} id - Order id.
		 * @returns {any} Stored order.
		 */
		get(id) {
			return rows.get(id);
		},
	};
}

/**
 * Payment gateway fake with sequential ids and named failure modes.
 *
 * @param {"ok" | "refused" | "lost-response"} [mode] - How the gateway behaves.
 * @returns {{ refund(paymentId: string, cents: number, key: string): Promise<{ id: string }>, calls: object[] }} Gateway.
 */
function makeGateway(mode = "ok") {
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

			if (mode === "refused") throw new Error("gateway: refused");
			if (mode === "lost-response") throw new Error("gateway: lost response");

			return { id: `rf-${calls.length}` };
		},
	};
}

/**
 * Fixed clock at an offset from the delivery time.
 *
 * @param {number} offsetMs - Milliseconds after delivery.
 * @returns {{ now(): Date }} Clock.
 */
function clockAt(offsetMs) {
	return {
		/**
		 * Current time.
		 *
		 * @returns {Date} Fixed instant.
		 */
		now() {
			return new Date(new Date(DELIVERED_AT).getTime() + offsetMs);
		},
	};
}

/**
 * Wire a refund service over fakes.
 *
 * @param {{ orders?: object[], mode?: string, offsetMs?: number }} [options] - Setup.
 * @returns {{ service: any, store: any, gateway: any }} Harness.
 */
function setup(options = {}) {
	const store = makeStore(options.orders ?? [makeOrder()]);
	const gateway = makeGateway(options.mode);
	const service = createRefunds({ orders: store, gateway, clock: clockAt(options.offsetMs ?? DAY_MS) });

	return { service, store, gateway };
}

test("refunds the requested lines, calls the gateway with a sorted idempotency key and returns its id", async function happyPath() {
	const { service, store, gateway } = setup();

	const outcome = await service.refund("ord-1", { lineIds: ["l3", "l1"], opened: false });

	assert.deepEqual(outcome, { ok: true, refundId: "rf-1", cents: 4000 });
	assert.deepEqual(gateway.calls, [{ paymentId: "pay-1", cents: 4000, key: "ord-1:l1,l3" }]);
	assert.deepEqual(
		store.get("ord-1").lines.map(function flag(line) {
			return [line.id, line.refunded];
		}),
		[
			["l3", true],
			["l1", true],
			["l2", false],
		],
	);
	assert.equal(store.saves.length, 1);
});

test("idempotency key does not depend on request order or line storage order", async function keyOrder() {
	const first = setup();
	const second = setup();

	await first.service.refund("ord-1", { lineIds: ["l2", "l1", "l3"], opened: false });
	await second.service.refund("ord-1", { lineIds: ["l1", "l3", "l2"], opened: false });

	assert.deepEqual([first.gateway.calls[0].key, second.gateway.calls[0].key], ["ord-1:l1,l2,l3", "ord-1:l1,l2,l3"]);
});

test("opened items lose a 15% restocking fee rounded to the nearest cent", async function restockingFee() {
	// Expected refunds are worked out by hand: gross - round(gross * 0.15).
	const cases = [
		{ gross: 1000, opened: true, cents: 850 },
		{ gross: 1000, opened: false, cents: 1000 },
		{ gross: 10, opened: true, cents: 8 }, // fee 1.5 rounds up to 2
		{ gross: 3, opened: true, cents: 3 }, // fee 0.45 rounds down to 0
		{ gross: 7, opened: true, cents: 6 }, // fee 1.05 rounds down to 1
		{ gross: 30, opened: true, cents: 25 }, // fee 4.5 rounds up to 5
	];
	const offenders = [];

	for (const row of cases) {
		const order = makeOrder({ lines: [{ id: "a", cents: row.gross, refunded: false }] });
		const { service, gateway } = setup({ orders: [order] });
		const outcome = await service.refund("ord-1", { lineIds: ["a"], opened: row.opened });

		if (outcome.cents !== row.cents || gateway.calls[0]?.cents !== row.cents) {
			offenders.push({ ...row, got: outcome.cents, sent: gateway.calls[0]?.cents });
		}
	}

	assert.deepEqual(offenders, []);
});

test("fee applies to the sum of all refunded lines, not per line", async function feeOnGross() {
	// 3 + 3 cents: per line round(0.45) = 0 each; on gross 6, round(0.9) = 1.
	const order = makeOrder({
		lines: [
			{ id: "a", cents: 3, refunded: false },
			{ id: "b", cents: 3, refunded: false },
		],
	});
	const { service } = setup({ orders: [order] });

	const outcome = await service.refund("ord-1", { lineIds: ["a", "b"], opened: true });

	assert.deepEqual(outcome, { ok: true, refundId: "rf-1", cents: 5 });
});

test("refund window: allowed up to exactly 30 days after delivery, closed after", async function windowBoundary() {
	const cases = [
		{ offsetMs: 0, reason: null },
		{ offsetMs: 29 * DAY_MS, reason: null },
		{ offsetMs: 30 * DAY_MS, reason: null },
		{ offsetMs: 30 * DAY_MS + 1, reason: "window-closed" },
		{ offsetMs: 31 * DAY_MS, reason: "window-closed" },
		{ offsetMs: 365 * DAY_MS, reason: "window-closed" },
	];
	const offenders = [];

	for (const row of cases) {
		const { service } = setup({ offsetMs: row.offsetMs });
		const outcome = await service.refund("ord-1", { lineIds: ["l1"], opened: false });
		const reason = outcome.ok ? null : outcome.reason;

		if (reason !== row.reason) offenders.push({ ...row, got: reason });
	}

	assert.deepEqual(offenders, []);
});

test("every refusal maps to its reason and touches neither the gateway nor the store", async function refusals() {
	const cases = [
		{ name: "unknown order", orderId: "missing", order: makeOrder(), lineIds: ["l1"], offsetMs: DAY_MS, reason: "not-found" },
		{ name: "shipped", orderId: "ord-1", order: makeOrder({ status: "shipped" }), lineIds: ["l1"], offsetMs: DAY_MS, reason: "not-delivered" },
		{
			name: "cancelled",
			orderId: "ord-1",
			order: makeOrder({ status: "cancelled" }),
			lineIds: ["l1"],
			offsetMs: DAY_MS,
			reason: "not-delivered",
		},
		{
			name: "not delivered beats window",
			orderId: "ord-1",
			order: makeOrder({ status: "shipped" }),
			lineIds: ["l1"],
			offsetMs: 90 * DAY_MS,
			reason: "not-delivered",
		},
		{ name: "window closed", orderId: "ord-1", order: makeOrder(), lineIds: ["l1"], offsetMs: 40 * DAY_MS, reason: "window-closed" },
		{ name: "no lines requested", orderId: "ord-1", order: makeOrder(), lineIds: [], offsetMs: DAY_MS, reason: "nothing-to-refund" },
		{ name: "unknown line ids", orderId: "ord-1", order: makeOrder(), lineIds: ["zz"], offsetMs: DAY_MS, reason: "nothing-to-refund" },
		{
			name: "all requested lines already refunded",
			orderId: "ord-1",
			order: makeOrder({
				lines: [
					{ id: "l1", cents: 1000, refunded: true },
					{ id: "l2", cents: 2000, refunded: false },
				],
			}),
			lineIds: ["l1"],
			offsetMs: DAY_MS,
			reason: "nothing-to-refund",
		},
	];
	const offenders = [];

	for (const row of cases) {
		const { service, store, gateway } = setup({ orders: [row.order], offsetMs: row.offsetMs });
		const outcome = await service.refund(row.orderId, { lineIds: row.lineIds, opened: false });
		const expected = { ok: false, reason: row.reason };

		if (JSON.stringify(outcome) !== JSON.stringify(expected) || gateway.calls.length !== 0 || store.saves.length !== 0) {
			offenders.push({ name: row.name, outcome, gatewayCalls: gateway.calls.length, saves: store.saves.length });
		}
	}

	assert.deepEqual(offenders, []);
});

test("already refunded lines are skipped from a mixed request", async function partialAlreadyRefunded() {
	const order = makeOrder({
		lines: [
			{ id: "l1", cents: 1000, refunded: true },
			{ id: "l2", cents: 2000, refunded: false },
		],
	});
	const { service, gateway } = setup({ orders: [order] });

	const outcome = await service.refund("ord-1", { lineIds: ["l1", "l2"], opened: false });

	assert.deepEqual(outcome, { ok: true, refundId: "rf-1", cents: 2000 });
	assert.deepEqual(gateway.calls, [{ paymentId: "pay-1", cents: 2000, key: "ord-1:l2" }]);
});

test("a line cannot be refunded twice across calls", async function noDoubleRefund() {
	const { service, gateway } = setup();

	const first = await service.refund("ord-1", { lineIds: ["l1"], opened: false });
	const second = await service.refund("ord-1", { lineIds: ["l1"], opened: false });
	const third = await service.refund("ord-1", { lineIds: ["l1", "l2"], opened: false });

	assert.deepEqual(
		[first, second, third],
		[
			{ ok: true, refundId: "rf-1", cents: 1000 },
			{ ok: false, reason: "nothing-to-refund" },
			{ ok: true, refundId: "rf-2", cents: 2000 },
		],
	);
	assert.deepEqual(
		gateway.calls.map(function keyOf(call) {
			return call.key;
		}),
		["ord-1:l1", "ord-1:l2"],
	);
});

for (const mode of ["refused", "lost-response"]) {
	test(`gateway failure (${mode}) propagates and leaves the order unrefunded and unsaved`, async function gatewayFailure() {
		const { service, store, gateway } = setup({ mode });

		await assert.rejects(service.refund("ord-1", { lineIds: ["l1"], opened: false }), new RegExp(`gateway: ${mode.replace("-", " ")}`));

		assert.equal(gateway.calls.length, 1);
		assert.deepEqual(store.saves, []);
		assert.deepEqual(
			store.get("ord-1").lines.filter(function isRefunded(line) {
				return line.refunded;
			}),
			[],
		);
	});
}
