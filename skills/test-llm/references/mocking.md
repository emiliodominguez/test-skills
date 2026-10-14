# Mocking the model

Inject the model (or the client) into the feature, and replace it in tests at the narrowest seam
the SDK offers. Assert on what the code sent and what it did, never on the reply you scripted.

## Choosing the seam

| Seam | Use for | Cost |
| --- | --- | --- |
| SDK mock model (provider interface) | Prompt assembly, parsing, tool dispatch, retries around SDK calls, streaming | Cheapest; needs the SDK's test helpers |
| HTTP mock (MSW, nock, respx) | Hand-written clients, retry and backoff on status codes, request body shape, provider quirks | Needs the provider's wire format |
| Recorded responses (cassettes) | Replaying real outputs in parser and pipeline tests; detecting wire format drift | Re-record on a schedule; scrub keys and PII |
| Fake implementation of your own interface | Code that hides the SDK behind a `complete(messages)` port | Most portable; does not exercise the SDK |

## Vercel AI SDK (verified with ai 7.0.139)

`ai/test` exports `MockLanguageModelV4` (and `MockLanguageModelV3` for the previous provider
spec). `doGenerate` and `doStream` accept a single result, an array served in order, or a
function. Every call is recorded in `doGenerateCalls` / `doStreamCalls` with the normalized
prompt: the system message has string content, user content is an array of parts.

```ts
import { MockLanguageModelV4 } from "ai/test";
import { expect } from "vitest";
// runTriage, ticket, store and FINAL_JSON come from the feature and its fixtures.

type GenerateResult = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;

const USAGE = {
	inputTokens: { total: 120, noCache: 120, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 30, text: 30, reasoning: 0 },
};

/**
 * A text result in the V4 provider format.
 *
 * @param text - Model text.
 * @returns The result.
 */
function textResult(text: string): GenerateResult {
	return { content: [{ type: "text", text }], finishReason: { unified: "stop", raw: "stop" }, usage: USAGE, warnings: [] };
}

const model = new MockLanguageModelV4({
	/**
	 * Answer by what the model was sent, not by call index.
	 *
	 * @param options - Call options the SDK passed.
	 * @returns The scripted result.
	 */
	async doGenerate(options) {
		if (options.prompt.at(-1)?.role === "tool") return textResult(FINAL_JSON);

		return {
			content: [{ type: "tool-call", toolCallId: "call-1", toolName: "lookupOrder", input: JSON.stringify({ orderId: "A-1002" }) }],
			finishReason: { unified: "tool-calls", raw: "tool_calls" },
			usage: USAGE,
			warnings: [],
		};
	},
});

await runTriage(ticket, { model, store });
expect(model.doGenerateCalls[0]?.prompt[0]).toEqual({ role: "system", content: expect.stringContaining("es-AR") });
```

Version notes for ai 7.0.139, checked in this repository:

- Finish reason is an object `{ unified, raw }`; usage is nested (`inputTokens.total`,
  `outputTokens.total`, cache and reasoning counts).
- Tool-call `input` is a JSON string in the provider result; `result.toolCalls[n].input` is the
  parsed object.
- Tools defined with `tool({ description, inputSchema })` and no `execute` make `generateText`
  return the calls and stop, so the feature can dispatch them itself with its own retry and
  idempotency rules. Append `result.response.messages` and a `role: "tool"` message with
  `{ type: "tool-result", toolCallId, toolName, output: { type: "json", value } }` parts for the
  next call.
- `Output.object({ schema })` throws `NoObjectGeneratedError` for unparseable text and for text
  that parses but fails the schema; use `NoObjectGeneratedError.isInstance(error)`.
- `simulateReadableStream` is exported from `ai`; the `ai/test` re-export is deprecated. Pass
  `initialDelayInMs: null` and `chunkDelayInMs: null` for no delays. A V4 stream is
  `stream-start`, `text-start`, `text-delta` (`delta` field), `text-end`, `finish`.
- Pass `maxRetries: 0` in tests so the SDK's retry does not hide the feature's retry policy.

```ts
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
// USAGE as defined in the block above.

const model = new MockLanguageModelV4({
	doStream: {
		stream: simulateReadableStream({
			chunks: [
				{ type: "stream-start", warnings: [] },
				{ type: "text-start", id: "t1" },
				{ type: "text-delta", id: "t1", delta: "Write to ana.perez@" },
				{ type: "text-delta", id: "t1", delta: "example.com today." },
				{ type: "text-end", id: "t1" },
				{ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: USAGE },
			],
			initialDelayInMs: null,
			chunkDelayInMs: null,
		}),
	},
});
```

Split chunks at the worst places: inside an address, inside a JSON string, between a tool call's
argument deltas, and, for code that parses server-sent events from bytes, inside a multi-byte
character.

## HTTP level with MSW (verified with msw 3.0.3)

For hand-written clients or any SDK that sends requests through `fetch`, mock the provider's
endpoint. MSW 3 renamed the unhandled option: `server.listen({ onUnhandledFrame: "error" })`;
`onUnhandledRequest` no longer type-checks. With it, an unhandled request rejects instead of
reaching the network.

```ts
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, test } from "vitest";

const server = setupServer();
const bodies: unknown[] = [];

beforeAll(function listen() {
	server.listen({ onUnhandledFrame: "error" });
});

afterEach(function reset() {
	server.resetHandlers();
	bodies.length = 0;
});

afterAll(function close() {
	server.close();
});

test("a rate limit honors Retry-After", async function rateLimit() {
	server.use(
		http.post("https://llm.example.test/v1/chat/completions", async function respond({ request }) {
			bodies.push(await request.json());

			if (bodies.length === 1) return HttpResponse.json({ error: { message: "rate limited" } }, { status: 429, headers: { "retry-after": "2" } });

			return HttpResponse.json({ choices: [{ index: 0, message: { role: "assistant", content: "Hola" }, finish_reason: "stop" }] });
		}),
	);
	// ... create the client with an injected sleep, then assert on bodies and waits
});
```

Test the status matrix: 400 and 401 never retried, 408, 429 and 5xx retried with backoff and
`Retry-After` capped, a timeout aborts the request, a 200 with a malformed body is a typed error.

## Other stacks (options, not verified here)

- **Provider SDKs over HTTP:** point `baseURL` at an MSW-handled URL (Node) or mock `httpx` with respx
  (Python). Check how your SDK version retries by default and turn that off in tests.
- **LangChain:** fake chat models in `@langchain/core/utils/testing` (JavaScript) and
  `langchain_core.language_models.fake_chat_models` (Python), such as fake list and generic fake
  chat models; check which support tool calls in your version.
- **Python in general:** inject a client protocol and pass a fake; for replay, record cassettes
  with vcrpy or pytest-recording and scrub authorization headers.
- **Any language:** a fake server that speaks the chat completions wire format, started per test
  file on a random port, also serves a local smoke run against the same client code.

## Recorded responses

Record real responses once per model version, scrub keys and PII, and replay them through the
parser and pipeline. They catch wire format drift (a new finish reason, a renamed field, a tool
call split differently) that hand-written mocks never will. Re-record on a schedule and on every
model change; a cassette older than the model it claims to represent is a hand-written mock.
