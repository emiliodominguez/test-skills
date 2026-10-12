// Refund service for the before/after evaluation. Amounts are integer cents.
// Dependencies are passed in: an order store, a payment gateway and a clock.

/** Refunds are allowed for this many days after delivery. */
export const REFUND_WINDOW_DAYS = 30;

/** Restocking fee for opened items, in percent. */
export const RESTOCKING_PERCENT = 15;

/**
 * Create the refund service.
 *
 * @param {{ orders: { find(id: string): Promise<any>, save(order: any): Promise<void> }, gateway: { refund(paymentId: string, cents: number, key: string): Promise<{ id: string }> }, clock: { now(): Date } }} deps - Dependencies.
 * @returns {{ refund(orderId: string, request: { lineIds: string[], opened: boolean }): Promise<{ ok: true, refundId: string, cents: number } | { ok: false, reason: string }> }} The service.
 */
export function createRefunds(deps) {
	/**
	 * Refund some lines of an order.
	 *
	 * @param {string} orderId - Order id.
	 * @param {{ lineIds: string[], opened: boolean }} request - Lines to refund and whether items were opened.
	 * @returns {Promise<{ ok: true, refundId: string, cents: number } | { ok: false, reason: string }>} Outcome.
	 */
	async function refund(orderId, request) {
		const order = await deps.orders.find(orderId);

		if (!order) return { ok: false, reason: "not-found" };
		if (order.status !== "delivered") return { ok: false, reason: "not-delivered" };

		const days = (deps.clock.now().getTime() - new Date(order.deliveredAt).getTime()) / 86_400_000;

		if (days > REFUND_WINDOW_DAYS) return { ok: false, reason: "window-closed" };

		const lines = order.lines.filter(function requested(line) {
			return request.lineIds.includes(line.id) && !line.refunded;
		});

		if (lines.length === 0) return { ok: false, reason: "nothing-to-refund" };

		const gross = lines.reduce(function sum(acc, line) {
			return acc + line.cents;
		}, 0);
		const fee = request.opened ? Math.round((gross * RESTOCKING_PERCENT) / 100) : 0;
		const cents = gross - fee;
		const key = `${orderId}:${lines
			.map(function idOf(line) {
				return line.id;
			})
			.sort()
			.join(",")}`;
		const result = await deps.gateway.refund(order.paymentId, cents, key);

		for (const line of lines) line.refunded = true;
		await deps.orders.save(order);

		return { ok: true, refundId: result.id, cents };
	}

	return { refund };
}
