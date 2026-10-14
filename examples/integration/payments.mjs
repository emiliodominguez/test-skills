// An HTTP client for a payment provider, with the boundary bugs fault injection finds: no
// timeout (a stalled provider stalls the caller), retries without an idempotency key (a lost
// response after the provider charged becomes a second charge), retries on a refusal that will
// never succeed, and a success body trusted without checking its shape.
import { randomUUID } from "node:crypto";

/** A failed charge, with a reason the caller can branch on. */
export class PaymentError extends Error {
	/**
	 * @param {"rejected" | "malformed" | "unavailable"} reason - Why the charge failed.
	 * @param {string} message - Human-readable explanation.
	 * @param {{ cause?: unknown }} [options] - The underlying error, if any.
	 */
	constructor(reason, message, options) {
		super(message, options);
		this.name = "PaymentError";
		this.reason = reason;
	}
}

/**
 * Wait for a number of milliseconds.
 *
 * @param {number} ms - Delay.
 * @returns {Promise<void>} Resolves after the delay.
 */
function sleep(ms) {
	return new Promise(function wait(resolve) {
		setTimeout(resolve, ms);
	});
}

/**
 * Whether a response status is worth retrying: the provider may succeed next time.
 *
 * @param {number} status - HTTP status.
 * @returns {boolean} True for 408, 429 and 5xx.
 */
function isRetryableStatus(status) {
	return status === 408 || status === 429 || status >= 500;
}

/**
 * Create a payment client.
 *
 * @param {{ baseUrl: string, timeoutMs?: number, maxAttempts?: number, backoffMs?: number, fixed?: boolean, newKey?: { (): string } }} config
 *   Provider origin; per-attempt timeout; attempt budget; base backoff, doubled per retry; `fixed` turns the bugs off;
 *   idempotency key factory.
 * @returns {{ charge(request: { orderId: string, amountCents: number }): Promise<{ id: string, amount_cents: number }> }} The client.
 */
export function createPaymentClient(config) {
	const { baseUrl, timeoutMs = 2_000, maxAttempts = 3, backoffMs = 20, fixed = false, newKey = randomUUID } = config;

	/**
	 * Send one attempt.
	 *
	 * @param {{ orderId: string, amountCents: number }} request - The charge.
	 * @param {string} key - Idempotency key shared by every attempt of this charge.
	 * @returns {Promise<Response>} The provider's response.
	 */
	function send(request, key) {
		/** @type {Record<string, string>} */
		const headers = { "content-type": "application/json" };

		if (fixed) headers["idempotency-key"] = key;

		return fetch(`${baseUrl}/charges`, {
			method: "POST",
			headers,
			body: JSON.stringify({ order_id: request.orderId, amount_cents: request.amountCents }),
			// Bug when not fixed: no timeout, so a provider that never answers holds the caller forever.
			signal: fixed ? AbortSignal.timeout(timeoutMs) : undefined,
		});
	}

	/**
	 * Charge an order, retrying transient failures.
	 *
	 * @param {{ orderId: string, amountCents: number }} request - The charge.
	 * @returns {Promise<{ id: string, amount_cents: number }>} The provider's charge record.
	 * @throws {PaymentError} When the provider refuses, answers malformed or stays unavailable.
	 */
	async function charge(request) {
		const key = newKey();
		let lastError;

		for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
			if (attempt > 1) await sleep(backoffMs * 2 ** (attempt - 2));

			let response;

			try {
				response = await send(request, key);
			} catch (error) {
				lastError = error;
				continue;
			}

			if (!fixed) {
				// Bug: every non-2xx is retried, including refusals, and any 2xx body is trusted.
				if (!response.ok) {
					lastError = new Error(`HTTP ${response.status}`);
					continue;
				}

				return response.json();
			}

			if (!response.ok) {
				if (isRetryableStatus(response.status)) {
					lastError = new Error(`HTTP ${response.status}`);
					continue;
				}

				throw new PaymentError("rejected", `provider refused the charge: HTTP ${response.status}`);
			}

			const body = await response.json().catch(function notJson() {
				return undefined;
			});

			if (typeof body?.id !== "string" || body.amount_cents !== request.amountCents) {
				throw new PaymentError("malformed", `unexpected charge body: ${JSON.stringify(body)}`);
			}

			return body;
		}

		throw new PaymentError("unavailable", `no answer after ${maxAttempts} attempts`, { cause: lastError });
	}

	return { charge };
}
