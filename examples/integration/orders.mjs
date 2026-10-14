// Both sides of an HTTP contract. The consumer fetches an order and adds shipping; the provider
// serves orders and has three versions: 1, 2 adds a field (compatible), 3 serializes the total as
// a string (a drift no single side's tests notice: JavaScript coerces "1999" / 100 to 19.99, but
// "1999" + 500 to "1999500").
import { z } from "zod";

/** What the consumer relies on. Unknown fields are stripped, not refused: a tolerant reader. */
export const ConsumerOrder = z.object({
	id: z.string(),
	status: z.enum(["open", "paid", "refunded"]),
	total_cents: z.number().int().nonnegative(),
	currency: z.string().length(3),
	customer: z.object({ id: z.string(), email: z.string() }),
});

/** What the consumer expects when an order does not exist. */
export const ConsumerNotFound = z.object({ error: z.literal("not_found") });

/**
 * The response schema the provider publishes for each version, as it would appear in its OpenAPI
 * document. Compatibility checks diff these before any consumer runs.
 *
 * @param {1 | 2 | 3} version - Provider version.
 * @returns {z.ZodObject} The published order schema.
 */
export function providerOrderSchema(version) {
	const base = {
		id: z.string(),
		status: z.enum(["open", "paid", "refunded"]),
		total_cents: version >= 3 ? z.string() : z.number().int().nonnegative(),
		currency: z.string().length(3),
		customer: z.object({ id: z.string(), email: z.string() }),
	};

	return version >= 2 ? z.object({ ...base, placed_at: z.string() }) : z.object(base);
}

/**
 * The provider: a `node:http` request listener serving `GET /orders/:id`.
 *
 * @param {{ version: 1 | 2 | 3 }} options - Which provider version to serve.
 * @returns {import("node:http").RequestListener} The listener.
 */
export function createOrdersProvider(options) {
	/** @type {Map<string, { id: string, status: string, total_cents: number, currency: string, customer: { id: string, email: string } }>} */
	const orders = new Map([
		["o-1", { id: "o-1", status: "paid", total_cents: 1999, currency: "EUR", customer: { id: "c-7", email: "ana@example.com" } }],
	]);

	/**
	 * Serve one request.
	 *
	 * @param {import("node:http").IncomingMessage} request - The incoming request.
	 * @param {import("node:http").ServerResponse} response - The response to write.
	 * @returns {void}
	 */
	return function handle(request, response) {
		const match = /^\/orders\/([^/]+)$/u.exec(request.url ?? "");
		const order = match ? orders.get(decodeURIComponent(match[1] ?? "")) : undefined;

		response.setHeader("content-type", "application/json");

		if (request.method !== "GET" || !order) {
			response.statusCode = 404;
			response.end(JSON.stringify({ error: "not_found" }));

			return;
		}

		/** @type {Record<string, unknown>} */
		const body = { ...order };

		if (options.version >= 2) body.placed_at = "2026-10-01T09:30:00Z";
		// Drift: a serializer change to keep large integers exact sends every integer as a string.
		if (options.version >= 3) body.total_cents = String(order.total_cents);

		response.statusCode = 200;
		response.end(JSON.stringify(body));
	};
}

/**
 * Consumer: fetch an order.
 *
 * @param {string} baseUrl - Provider origin.
 * @param {string} id - Order id.
 * @param {{ fixed?: boolean }} [options] - `fixed` parses the body with the consumer schema instead of trusting it.
 * @returns {Promise<z.infer<typeof ConsumerOrder>>} The order.
 * @throws {Error} When the order is missing or, in the fixed version, the body breaks the contract.
 */
export async function fetchOrder(baseUrl, id, options = {}) {
	const response = await fetch(`${baseUrl}/orders/${encodeURIComponent(id)}`);
	const body = await response.json();

	if (!response.ok) throw new Error(`order ${id}: HTTP ${response.status}`);

	return options.fixed ? ConsumerOrder.parse(body) : body;
}

/**
 * Consumer: the amount to charge, in cents.
 *
 * @param {{ total_cents: number }} order - A fetched order.
 * @param {number} shippingCents - Shipping in cents.
 * @returns {number} Total plus shipping.
 */
export function amountDue(order, shippingCents) {
	return order.total_cents + shippingCents;
}

/**
 * Changes from one published response schema to the next that break a consumer reading it:
 * a removed or newly optional field, a changed type, or a new enum value. Added fields are
 * compatible. Works on JSON Schema objects, such as `z.toJSONSchema` output or an OpenAPI
 * component.
 *
 * @param {Record<string, any>} previous - The schema consumers were built against.
 * @param {Record<string, any>} next - The proposed schema.
 * @param {string} [path] - JSON path of the current node, for messages.
 * @returns {string[]} One message per breaking change; empty when compatible.
 */
export function breakingResponseChanges(previous, next, path = "$") {
	/** @type {string[]} */
	const changes = [];

	if (JSON.stringify(previous.type) !== JSON.stringify(next.type)) {
		changes.push(`${path}: type ${JSON.stringify(previous.type)} -> ${JSON.stringify(next.type)}`);

		return changes;
	}

	if (Array.isArray(previous.enum) && Array.isArray(next.enum)) {
		for (const value of next.enum) if (!previous.enum.includes(value)) changes.push(`${path}: new enum value ${JSON.stringify(value)}`);
	}

	const previousRequired = new Set(previous.required ?? []);
	const nextRequired = new Set(next.required ?? []);

	for (const [name, schema] of Object.entries(previous.properties ?? {})) {
		const counterpart = next.properties?.[name];

		if (counterpart === undefined) changes.push(`${path}.${name}: removed`);
		else {
			if (previousRequired.has(name) && !nextRequired.has(name)) changes.push(`${path}.${name}: no longer required`);

			changes.push(...breakingResponseChanges(schema, counterpart, `${path}.${name}`));
		}
	}

	return changes;
}
