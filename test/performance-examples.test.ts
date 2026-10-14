// Evidence for the performance checks `test-performance` teaches: each example module has a
// regression that functional tests miss. A deterministic count (key calls, queries) catches it on
// every change, and a scaling ratio of the fastest samples at n and 8n separates quadratic from
// linear time without an absolute time budget. Each check passes on the fixed module.
import { describe, expect, test } from "vitest";
import { dedupeBy, loadOrderSummaries } from "../examples/performance/modules.mjs";
import { measureScaling } from "../examples/performance/scaling.mjs";

type Options = { fixed?: boolean };
type Item = { sku: string };
type Order = { id: string; customerId: string; totalCents: number };
type Customer = { id: string; name: string };

/** Variants every check runs against: the regression and the fix. */
const VARIANTS: ReadonlyArray<{ label: string; options: Options }> = [
	{ label: "buggy", options: {} },
	{ label: "fixed", options: { fixed: true } },
];

/**
 * Items with distinct SKUs, the worst case for a dedupe that rescans what it kept.
 *
 * @param size - Number of items.
 * @returns Items `sku-0` to `sku-<size - 1>`.
 */
function makeItems(size: number): Item[] {
	return Array.from({ length: size }, function item(_, index) {
		return { sku: `sku-${index}` };
	});
}

/**
 * Key of an item.
 *
 * @param item - An item.
 * @returns Its SKU.
 */
function skuOf(item: Item): string {
	return item.sku;
}

/**
 * Count how many times the dedupe derives a key for an input of a given size.
 *
 * @param size - Number of distinct items.
 * @param options - Variant to run.
 * @returns Key calls made by one dedupe.
 */
function keyCalls(size: number, options: Options): number {
	let calls = 0;

	dedupeBy(
		makeItems(size),
		function countingKey(item: Item) {
			calls += 1;

			return item.sku;
		},
		options,
	);

	return calls;
}

/**
 * An in-memory order store that counts its round trips, standing in for the database boundary.
 *
 * @param orderCount - Orders in account `acct-1`, spread over five customers.
 * @returns The store and a reader for the number of queries it served.
 */
function createCountingStore(orderCount: number) {
	const customers: Customer[] = Array.from({ length: 5 }, function customer(_, index) {
		return { id: `cust-${index}`, name: `Customer ${index}` };
	});
	const orders: Order[] = Array.from({ length: orderCount }, function order(_, index) {
		return { id: `ord-${index}`, customerId: `cust-${index % customers.length}`, totalCents: 100 * (index + 1) };
	});
	let queries = 0;

	const store = {
		/**
		 * Orders of an account, one query.
		 *
		 * @param accountId - Account id; only `acct-1` has orders.
		 * @returns The orders.
		 */
		async ordersForAccount(accountId: string): Promise<Order[]> {
			queries += 1;

			return accountId === "acct-1" ? orders : [];
		},
		/**
		 * One customer, one query.
		 *
		 * @param id - Customer id.
		 * @returns The customer, if any.
		 */
		async customerById(id: string): Promise<Customer | undefined> {
			queries += 1;

			return customers.find(function matches(customer) {
				return customer.id === id;
			});
		},
		/**
		 * Many customers, one query.
		 *
		 * @param ids - Customer ids.
		 * @returns The customers found.
		 */
		async customersByIds(ids: readonly string[]): Promise<Customer[]> {
			queries += 1;

			return customers.filter(function requested(customer) {
				return ids.includes(customer.id);
			});
		},
	};

	return {
		store,
		/**
		 * Queries served so far.
		 *
		 * @returns The count.
		 */
		queries(): number {
			return queries;
		},
	};
}

/**
 * Queries one call of the loader makes for an account with a given number of orders.
 *
 * @param orderCount - Orders in the account.
 * @param options - Variant to run.
 * @returns Number of queries.
 */
async function loaderQueries(orderCount: number, options: Options): Promise<number> {
	const counting = createCountingStore(orderCount);

	await loadOrderSummaries(counting.store, "acct-1", options);

	return counting.queries();
}

describe("operation count: key calls of a keyed dedupe", function keyCallSuite() {
	/** Budget: a linear dedupe derives each key at most twice. */
	const KEY_CALLS_PER_ITEM = 2;

	test("a functional test passes on the regression", function functional() {
		const items = [{ sku: "a" }, { sku: "b" }, { sku: "a" }, { sku: "c" }, { sku: "b" }];

		for (const { options } of VARIANTS) {
			expect(dedupeBy(items, skuOf, options)).toEqual([{ sku: "a" }, { sku: "b" }, { sku: "c" }]);
		}
	});

	test("a per-item budget fails the quadratic dedupe and passes the fix", function budget() {
		const sizes = [100, 1000];
		const buggy = sizes.map(function count(size) {
			return keyCalls(size, {});
		});
		const fixed = sizes.map(function count(size) {
			return keyCalls(size, { fixed: true });
		});

		expect(fixed).toEqual(sizes);
		expect(buggy).toEqual([100 + (100 * 99) / 2, 1000 + (1000 * 999) / 2]);

		for (const [index, size] of sizes.entries()) {
			expect(fixed[index]).toBeLessThanOrEqual(KEY_CALLS_PER_ITEM * size);
			expect(buggy[index]).toBeGreaterThan(KEY_CALLS_PER_ITEM * size);
		}
	});
});

describe("operation count: queries of an order loader (N+1)", function queryCountSuite() {
	/** Budget: one query for the orders, one for all their customers, whatever the order count. */
	const QUERY_BUDGET = 2;

	test("a functional test passes on the regression", async function functional() {
		const [buggy, fixed] = await Promise.all(
			VARIANTS.map(function load({ options }) {
				return loadOrderSummaries(createCountingStore(7).store, "acct-1", options);
			}),
		);

		expect(buggy).toHaveLength(7);
		expect(buggy).toEqual(fixed);
		expect(fixed?.[6]).toEqual({ orderId: "ord-6", customerName: "Customer 1", totalCents: 700 });
	});

	test("a constant query budget fails the N+1 loader and passes the fix", async function budget() {
		const sizes = [3, 30];
		const buggy = await Promise.all(
			sizes.map(function count(size) {
				return loaderQueries(size, {});
			}),
		);
		const fixed = await Promise.all(
			sizes.map(function count(size) {
				return loaderQueries(size, { fixed: true });
			}),
		);

		expect(buggy).toEqual([4, 31]);
		expect(fixed).toEqual([QUERY_BUDGET, QUERY_BUDGET]);
		expect(
			buggy.every(function overBudget(queries) {
				return queries > QUERY_BUDGET;
			}),
		).toBe(true);
	});

	test("an empty account costs one query", async function empty() {
		const counting = createCountingStore(0);

		expect(await loadOrderSummaries(counting.store, "acct-1", { fixed: true })).toEqual([]);
		expect(counting.queries()).toBe(1);
	});
});

describe("scaling ratio: time at 8n over time at n", function scalingSuite() {
	/**
	 * Linear time gives a ratio near 8 and n log n near 10; quadratic gives about 64. The threshold
	 * sits three times above linear and more than twice below quadratic, so machine noise has to
	 * move a ratio by a factor of more than two to flip the verdict.
	 */
	const RATIO_THRESHOLD = 24;

	test("the ratio fails the quadratic dedupe and passes the fix", function ratio() {
		const [buggy, fixed] = VARIANTS.map(function measure({ options }) {
			return measureScaling(
				function run(items: Item[]) {
					return dedupeBy(items, skuOf, options);
				},
				makeItems,
				{ size: 200 },
			);
		});

		expect(buggy!.ratio, `buggy ratio ${buggy!.ratio.toFixed(1)}`).toBeGreaterThan(RATIO_THRESHOLD);
		expect(fixed!.ratio, `fixed ratio ${fixed!.ratio.toFixed(1)}`).toBeLessThan(RATIO_THRESHOLD);
	});
});
