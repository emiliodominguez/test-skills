# Async UI

Anything that renders after a promise, effect, timer or subscription is async. Wait for what a
person would see, never for a duration.

## Waiting

- `await screen.findByRole(...)` for something that appears. Default timeout 1000 ms
  (Testing Library's `asyncUtilTimeout`), polling every 50 ms and on DOM mutations. Raise the
  timeout per call for a known slow path rather than globally.
- `await waitFor(function settled() { expect(...) })` for a state that changes without a new
  element: a value, an `aria-busy`, a disabled button becoming enabled. One assertion per
  callback; the callback is retried, so it must have no side effects (no clicks, no typing).
- `await waitForElementToBeRemoved(screen.getByRole("status"))` for a spinner that leaves. The
  element must exist when the call starts.
- Absence: wait for the settled positive state first, then `expect(screen.queryByRole("alert")).toBeNull()`.
  An absence check right after render passes before anything had a chance to appear.
- Do not wrap `findBy` in `waitFor`, do not put `getBy` inside `waitFor` without an assertion
  that can fail, and do not use an empty `waitFor` as a flush.

## Fake timers

Use them for debounce, throttle, polling, toasts that expire, session timeouts.

- Under Vitest, `vi.useFakeTimers()` freezes the timers Testing Library uses to poll, and it only
  advances Jest's fake timers on its own. Observed with Vitest 5 and @testing-library/dom 10.4,
  not asserted in this repository's evidence suite: a `findBy` waiting for content that a timer
  renders did not resolve before the test timeout under plain `vi.useFakeTimers()`. Use
  `vi.useFakeTimers({ shouldAdvanceTime: true })`, or advance the clock yourself before querying.
- Give user-event the clock: `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`
  (Jest: `jest.advanceTimersByTime`). Without it, awaited user-event calls wait on timers that
  do not advance.
- Restore real timers in `afterEach`, or one test's fake clock leaks into the next.

- Advancing fake timers by hand is the one place to wrap a call in `act`: the timer callbacks
  update state, and Testing Library does not wrap `vi.advanceTimersByTime` for you. Everywhere
  else, await the visible result instead.

```tsx
import { act, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

test("search waits for typing to pause", async function debounce() {
	vi.useFakeTimers({ shouldAdvanceTime: true });
	const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

	render(<ProductSearch />);
	await user.type(screen.getByRole("searchbox", { name: "Search products" }), "mug");
	act(function advanceDebounce() {
		vi.advanceTimersByTime(300);
	});

	expect(await screen.findByRole("list", { name: "Results" })).toBeTruthy();
});
```

## act

React batches updates inside `act` and warns, "An update to X inside a test was not wrapped in
act(...)", when state changes while the test was not waiting. Testing Library already wraps
`render`, `fireEvent`, user-event calls and its async utilities. A warning means the test
finished, or asserted, before a promise, timer or subscription settled. Fix it by awaiting the
visible result with `findBy` or `waitFor`; wrapping the line in `act` by hand hides the race.

React only warns when `globalThis.IS_REACT_ACT_ENVIRONMENT` is true. React Testing Library sets it,
and registers its automatic `cleanup`, through the runner's global `beforeAll`, `afterAll` and
`afterEach`. Vitest's default is `globals: false`, so neither happens: rendered trees stay in the
document for the next test, and act warnings stay silent. Measured in this repository with React
19.3 and React Testing Library 16.3: a fixed sleep before an assertion produced one or more act
warnings with the flag on (one in that example; each state update outside act can add one) and
none with it off. Fix it once in a setup file, or turn on the runner's globals.

One setup file (`setupFiles` in the runner config) that sets the act flag, cleans up, fails on
unhandled requests and fails the test on any unexpected `console.error`:

```ts
// test/setup.ts
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi, type MockInstance } from "vitest";
import { server } from "./server"; // setupServer(...handlers), see network.md

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let consoleError: MockInstance;

beforeAll(function listen() {
	server.listen({ onUnhandledFrame: "error" });
});

beforeEach(function watchConsole() {
	consoleError = vi.spyOn(console, "error");
});

afterEach(function cleanUpAndCheckConsole() {
	cleanup();
	server.resetHandlers();

	const calls = consoleError.mock.calls;

	consoleError.mockRestore();
	// Act warnings, MSW's unhandled-request log, key warnings: all fail the test that caused them.
	expect(calls).toEqual([]);
});

afterAll(function close() {
	server.close();
});
```

A test that expects a specific error (an error boundary, the test that proves an unhandled
request fails) allowlists it in place: `vi.mocked(console.error).mockImplementation(function
silence() {})`, assert the exact message from `vi.mocked(console.error).mock.calls`, then
`vi.mocked(console.error).mockClear()` so the guard sees only unexpected calls.

## Other async sources

- **Suspense and lazy components:** `findBy` the resolved content; assert the fallback with
  `getBy` right after render if the fallback matters.
- **Unmount during a request:** guard state updates with an abort signal or an `active` flag in
  the effect's cleanup, and test it by unmounting before the response resolves.
- **Animations and transitions:** disable them in the test setup (reduced motion, a zero
  duration) instead of waiting for them.
- **Subscriptions (websockets, stores, `matchMedia`):** push the event through the fake, then
  `findBy` the result.
