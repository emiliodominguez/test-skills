// A minimal client for an OpenAI-compatible chat completions endpoint, the shape many providers,
// gateways and local servers expose. It exists to show HTTP-level mocking with MSW in
// `test/llm-examples.test.ts`: the request body the feature sends and the retry policy are
// deterministic code worth testing without a model. `{ fixed: true }` turns the seeded bug off.

/**
 * @typedef {object} ChatClientOptions
 * @property {string} baseUrl - API base, such as `https://api.example.com/v1`.
 * @property {string} apiKey - Bearer token.
 * @property {string} model - Model id sent in the body.
 * @property {number} [maxAttempts] - Total attempts per call; defaults to 3.
 * @property {(ms: number) => Promise<void>} [sleep] - Injected so tests do not wait.
 * @property {boolean} [fixed] - Turns the bug off.
 */

/**
 * Whether an HTTP status is worth retrying.
 *
 * @param {number} status - Response status.
 * @param {boolean} fixed - Whether the bug is off.
 * @returns {boolean} True for rate limits and server errors.
 */
function isRetryable(status, fixed) {
	// Bug: every non-2xx is retried, so a malformed request is sent again and billed again.
	if (!fixed) return status >= 400;

	return status === 408 || status === 429 || status >= 500;
}

/**
 * Create a chat client.
 *
 * @param {ChatClientOptions} options - Endpoint, credentials and retry policy.
 * @returns {{ complete: (messages: Array<{ role: string, content: string }>) => Promise<string> }} The client.
 */
export function createChatClient(options) {
	const maxAttempts = options.maxAttempts ?? 3;
	const sleep =
		options.sleep ??
		function wait(ms) {
			return new Promise(function schedule(resolve) {
				setTimeout(resolve, ms);
			});
		};

	return {
		/**
		 * Send messages and return the first choice's text.
		 *
		 * @param {Array<{ role: string, content: string }>} messages - Chat messages.
		 * @returns {Promise<string>} The reply text.
		 * @throws {Error} With the status when the call fails for good.
		 */
		async complete(messages) {
			for (let attempt = 1; ; attempt += 1) {
				const response = await fetch(`${options.baseUrl}/chat/completions`, {
					method: "POST",
					headers: { "content-type": "application/json", authorization: `Bearer ${options.apiKey}` },
					body: JSON.stringify({ model: options.model, messages, temperature: 0 }),
				});

				if (response.ok) {
					const data = await response.json();

					return data.choices[0].message.content;
				}

				if (attempt >= maxAttempts || !isRetryable(response.status, Boolean(options.fixed))) {
					throw new Error(`chat completion failed with ${response.status}`);
				}

				const retryAfter = Number(response.headers.get("retry-after"));

				await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : 2 ** attempt * 250);
			}
		},
	};
}
