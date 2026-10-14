# Agents and tool calling

An agent run is a trajectory: model calls, tool calls with arguments, tool results, and an end
state. Test the loop's code with a scripted model and fake tools; evaluate the model's choices
with trajectory assertions on an eval set.

## The loop's code, with a scripted model

- **Dispatch:** the tool the model named runs with the arguments it chose, validated against
  the tool's schema; unknown tools and invalid arguments become tool errors returned to the
  model, never exceptions that kill the run. Defaults fill only what the model left out.
- **Side effects:** tools that write (refunds, emails, tickets) take an idempotency key derived
  from the tool call id, and retries wrap single model calls, not the turn. In this repository's
  example, retrying the whole turn after a transient failure issued a second refund; the fake
  store counted it.
- **Approvals:** a tool that needs approval pauses the run and resumes with the decision; test
  denied, approved and timed-out approvals.
- **Stop conditions:** step limit, token and cost limit, wall-clock limit, and a repeated
  identical call detector. Script a model that never stops calling tools and assert the run ends
  with a typed reason.
- **Tool failures:** fake tools fail by name (timeout, rate limit, not found, permission denied,
  malformed result, empty result) and the test asserts what the model is told and what the user
  sees.
- **Parallel calls:** several tool calls in one step run in a defined order or concurrently by
  design; results return with the right ids.

```ts
import { MockLanguageModelV4 } from "ai/test";
import { expect } from "vitest";
// GenerateResult, USAGE and textResult as defined in mocking.md. runTriage, createFakeStore,
// ticket and FINAL_JSON come from the feature and its fixtures.

/**
 * A tool-call result in the V4 provider format.
 *
 * @param toolCallId - Call id.
 * @param toolName - Tool name.
 * @param input - Arguments the model chose.
 * @returns The result.
 */
function toolCallResult(toolCallId: string, toolName: string, input: unknown): GenerateResult {
	return {
		content: [{ type: "tool-call", toolCallId, toolName, input: JSON.stringify(input) }],
		finishReason: { unified: "tool-calls", raw: "tool_calls" },
		usage: USAGE,
		warnings: [],
	};
}

const store = createFakeStore();
const model = new MockLanguageModelV4({
	/**
	 * Ask for a lookup, then answer once tool results are present.
	 *
	 * @param options - Call options.
	 * @returns The scripted result.
	 */
	async doGenerate(options) {
		return options.prompt.at(-1)?.role === "tool" ? textResult(FINAL_JSON) : toolCallResult("call-1", "lookupOrder", { orderId: "A-1002" });
	},
});
const run = await runTriage(ticket, { model, store });

expect(run.toolCalls).toEqual([{ toolCallId: "call-1", toolName: "lookupOrder", input: { orderId: "A-1002" } }]);
expect(
	store.calls.map(function name(call) {
		return call.tool;
	}),
).toEqual(["lookupOrder"]);
expect(run.modelCalls).toBeLessThanOrEqual(2);
```

## Trajectory assertions in evals

| Assertion | Example |
| --- | --- |
| Tool chosen | `issueRefund` called for a refund request; no tool called for a greeting |
| Arguments | `orderId` is the one in the message, `amountCents` equals the stated amount |
| Ordering that matters | `lookupOrder` before `issueRefund`; read before write |
| Forbidden | No `deleteAccount` without an approval; no external send with data from another tenant |
| Count | At most one `issueRefund` per order per run |
| End state | The fake store holds exactly one refund of 1999 for A-1002 |
| Budget | At most 6 steps, 20k tokens, a cost ceiling and 30 s wall time per task |

Prefer end-state and constraint assertions over an exact expected sequence: several paths are
often valid, and exact sequences fail on harmless reorderings. Use exact sequences only where
the order is the requirement.

## Reliability

Agents fail by compounding small error rates. Run each task k times (5-10) and report pass^k,
the share of tasks that pass on every trial; it falls much faster than the single-run pass rate
and is what a user who runs the task daily experiences. Track average steps and tokens per
passing task; a prompt that passes the same tasks in more steps is a cost regression.

## Environments

Give the agent fake tools backed by an in-memory store seeded per task, or a sandbox with a
reset between tasks. Never point an eval at production systems with write access. Record full
trajectories for every failing task; the first wrong tool call is usually the finding, and
`test-findings` turns it into a report.

Inspect, LangSmith, Braintrust and DeepEval offer agent and trajectory evaluation; check they can
assert on tool arguments and end state, not only on the final message.
