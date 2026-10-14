// Small modules with one realistic performance regression each, and their fixed versions, for the
// examples in `test/performance-examples.test.ts`. Both regressions return correct results, so
// functional tests pass on them: a keyed dedupe that rescans what it kept (quadratic), and an
// order loader that fetches each order's customer separately (N+1 queries).

/**
 * Keep the first item for each key, in input order.
 *
 * @template T
 * @param {readonly T[]} items - Items to deduplicate.
 * @param {(item: T) => string} key - Derives the identity of an item.
 * @param {{ fixed?: boolean }} [options] - `fixed` turns the regression off.
 * @returns {T[]} The first item seen for each key.
 */
export function dedupeBy(items, key, options = {}) {
	if (!options.fixed) {
		/** @type {T[]} */
		const kept = [];

		for (const item of items) {
			const identity = key(item);

			// Regression: rescans every kept item and recomputes its key, so n items cost O(n^2) key calls.
			const seen = kept.some(function sameIdentity(candidate) {
				return key(candidate) === identity;
			});

			if (!seen) kept.push(item);
		}

		return kept;
	}

	/** @type {Set<string>} */
	const seen = new Set();
	/** @type {T[]} */
	const kept = [];

	for (const item of items) {
		const identity = key(item);

		if (!seen.has(identity)) {
			seen.add(identity);
			kept.push(item);
		}
	}

	return kept;
}

/**
 * @typedef {{ id: string, customerId: string, totalCents: number }} Order
 * @typedef {{ id: string, name: string }} Customer
 * @typedef {{ orderId: string, customerName: string, totalCents: number }} OrderSummary
 */

/**
 * The data access the order loader needs. Each method is one round trip to the database.
 *
 * @typedef {object} OrderStore
 * @property {(accountId: string) => Promise<Order[]>} ordersForAccount - Orders of an account.
 * @property {(id: string) => Promise<Customer | undefined>} customerById - One customer.
 * @property {(ids: readonly string[]) => Promise<Customer[]>} customersByIds - Many customers in one query.
 */

/**
 * Summaries of an account's orders with each customer's name.
 *
 * @param {OrderStore} store - Data access; every call is one query.
 * @param {string} accountId - Account whose orders to load.
 * @param {{ fixed?: boolean }} [options] - `fixed` turns the regression off.
 * @returns {Promise<OrderSummary[]>} One summary per order, in store order.
 */
export async function loadOrderSummaries(store, accountId, options = {}) {
	const orders = await store.ordersForAccount(accountId);

	if (!options.fixed) {
		/** @type {OrderSummary[]} */
		const summaries = [];

		for (const order of orders) {
			// Regression: one query per order (N+1). Correct results, linear round trips.
			const customer = await store.customerById(order.customerId);

			summaries.push({ orderId: order.id, customerName: customer?.name ?? "unknown", totalCents: order.totalCents });
		}

		return summaries;
	}

	const customerIds = [
		...new Set(
			orders.map(function toCustomerId(order) {
				return order.customerId;
			}),
		),
	];
	const customers = customerIds.length === 0 ? [] : await store.customersByIds(customerIds);
	const byId = new Map(
		customers.map(function toEntry(customer) {
			return [customer.id, customer];
		}),
	);

	return orders.map(function toSummary(order) {
		return { orderId: order.id, customerName: byId.get(order.customerId)?.name ?? "unknown", totalCents: order.totalCents };
	});
}
