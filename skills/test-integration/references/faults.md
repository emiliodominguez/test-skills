# Fault injection at boundaries

## Catalog

| Fault | What must hold | Inject with |
| --- | --- | --- |
| No answer, or slower than the caller's budget | The call ends at its timeout; the caller's own latency stays bounded | Handler delay (msw `delay`, WireMock `withFixedDelay`); Toxiproxy `latency` or `timeout` for TCP |
| Response lost after the provider committed | A retry does not repeat the side effect: idempotency key, or a status lookup before retrying | Handler commits, then returns a network error (msw `HttpResponse.error()`); Toxiproxy `reset_peer` |
| Connection reset or refused | Retried within budget, then a typed "unavailable" error | msw `HttpResponse.error()`; WireMock `CONNECTION_RESET_BY_PEER`; stop the container or Toxiproxy `down` |
| 5xx, 429 with `Retry-After` | Bounded retries with backoff and jitter; `Retry-After` honored; circuit opens after repeated failure | Scripted status per attempt |
| 4xx refusal | Not retried; mapped to a domain error | Scripted status |
| Malformed, truncated or wrong-type body; HTML error page with 200 | Refused at the boundary with a typed error, never returned as data | Bad JSON or wrong shape; WireMock `MALFORMED_RESPONSE_CHUNK`, `RANDOM_DATA_THEN_CLOSE`, `EMPTY_RESPONSE`; Toxiproxy `limit_data` |
| Partial failure in a batch | Successful items kept, failed items reported or retried alone | Provider returns per-item results with some failures |
| Slow or throttled body | Read timeouts, not only connect timeouts | WireMock `withChunkedDribbleDelay`; Toxiproxy `bandwidth`, `slicer` |
| Duplicate message | Handled once: deduplicate by message id or make the handler idempotent | Publish the same message twice |
| Out-of-order messages | Stale updates ignored (versions, timestamps) | Publish in reverse order |
| Poison message | Moved to a dead-letter queue after N attempts; the rest of the queue keeps flowing | Publish a message the handler cannot parse |
| Database or broker unavailable mid-operation | Transaction rolled back; outbox or retry; no half-written state | Stop the container; Toxiproxy between the app and the engine |

## Assertions

Assert outcomes, not only that something threw:

- **Side effects counted:** rows, ledger entries or published messages equal one after any retry
  sequence. Read them from the dependency (the fake's ledger, the database), not the client.
- **Attempts counted:** the fake records each request; assert the exact number for each fault.
- **Latency bounded:** measure wall time for the timeout case and assert it is well under the
  stall. Keep the stall long and the timeout short (a 10:1 ratio held steady here), so the
  assertion has slack on a loaded machine.
- **Typed errors:** the caller can branch on a reason (`rejected`, `unavailable`, `malformed`),
  never on a message string.

## In-process HTTP: msw

msw intercepts `fetch` and Node's `http` in the test process, so no port or proxy is needed. A
fake provider with real semantics (idempotency keys honored, charges recorded) and a script of
faults per attempt covers most of the catalog:

```ts
const server = setupServer();

beforeAll(function listen() {
	server.listen({ onUnhandledFrame: "error" });
});
afterEach(function reset() {
	server.resetHandlers();
});
afterAll(function close() {
	server.close();
});

/**
 * Install a fake provider that honors idempotency keys and fails each attempt as scripted.
 *
 * @param faults - Fault per attempt, in order; later attempts succeed.
 * @returns The recorded charges and the attempt count.
 */
function fakeProvider(faults: Fault[]) {
	const ledger: string[] = [];
	const byKey = new Map<string, string>();
	const state = { attempts: 0 };

	server.use(
		http.post(`${PROVIDER}/charges`, async function charges({ request }) {
			const fault = faults[state.attempts] ?? "none";
			const key = request.headers.get("idempotency-key");

			state.attempts += 1;
			if (fault === "unavailable") return HttpResponse.json({ error: "unavailable" }, { status: 503 });

			let id = key ? byKey.get(key) : undefined;

			if (!id) {
				id = `ch_${ledger.push("charge")}`;
				if (key) byKey.set(key, id);
			}

			if (fault === "lose-response") return HttpResponse.error();
			if (fault === "stall") await delay(STALL_MS);

			return HttpResponse.json({ id }, { status: 201 });
		}),
	);

	return { ledger, state };
}
```

Verified with msw 3.0.3 in this repository:

- The option is `onUnhandledFrame` (`"error"`, `"warn"`, `"bypass"` or a function). The msw 2
  name `onUnhandledRequest` is ignored at runtime: the unmatched request warns and goes to the
  real network. TypeScript rejects the old name; plain JavaScript does not.
- `HttpResponse.error()` makes `fetch` reject with `TypeError: fetch failed`, like a dropped
  connection.
- A client's `AbortSignal.timeout` aborts a request stalled in `delay`; the handler keeps running,
  which is the realistic case of a provider that finishes after the client gave up.

Outside JavaScript: WireMock (Java, or standalone in a container for any language) with
scenarios for per-attempt state, `responses` or `respx` for Python, `httptest` servers for Go.

## Network faults: Toxiproxy

For faults between the application and a real engine (database, Redis, broker), put Toxiproxy
in front of it (a Testcontainers module exists) and add toxics during the test: `latency`,
`timeout`, `reset_peer`, `bandwidth`, `slow_close`, `slicer`, `limit_data`, or disable the proxy.
This tests driver and pool behavior (timeouts, reconnects, statement retries) that an HTTP stub
cannot reach. Run it on schedule if it slows the per-change suite.

## Recorded responses

Recordings (Polly.js, VCR-style libraries, WireMock record mode, nock's recorder) replay real
traffic cheaply but rot as the provider changes. Scrub secrets and personal data before
committing, re-record on schedule and diff the result, and validate recordings against the
provider's schema so drift fails a test instead of passing quietly.
