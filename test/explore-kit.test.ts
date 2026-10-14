import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { parseDuration } from "../examples/buggy-shop/fast-check/explore.mjs";
import { HOSTILE_TEXT, KEYS, defaultCommands, genericProperties, isEcho } from "../skills/test-explore/assets/fast-check-explore.mjs";

type Snapshot = { text: string; modalOpen: boolean; busy: boolean; injected: boolean; app: unknown };

const calm: Snapshot = { text: "Cart $12.50", modalOpen: false, busy: false, injected: false, app: null };

/**
 * A step with sensible defaults, overridden per test.
 *
 * @param overrides - Fields to change.
 * @returns A step as the properties receive it.
 */
function step(overrides: Record<string, unknown> = {}) {
	return {
		action: "click button",
		before: calm,
		after: calm,
		errors: [],
		consoleErrors: [],
		failedRequests: [],
		settled: true,
		typed: [],
		...overrides,
	};
}

/**
 * Verdicts of every generic property for one step, keyed by property name.
 *
 * @param overrides - Step fields to change.
 * @returns Property name to verdict.
 */
function verdicts(
	overrides: Record<string, unknown> = {},
	options: Parameters<typeof genericProperties>[0] = {},
): Record<string, boolean | string | null> {
	return Object.fromEntries(
		genericProperties(options).map(function judge(property) {
			return [property.name, property.check(step(overrides) as Parameters<typeof property.check>[0])];
		}),
	);
}

describe("generic properties", function genericSuite() {
	test("a calm step passes every property", function calmStep() {
		expect(Object.values(verdicts())).toEqual([true, true, true, true, true, true, true]);
	});

	test("an uncaught error names the error", function uncaught() {
		expect(verdicts({ errors: ["boom"] }).noUncaughtErrors).toBe("uncaught: boom");
	});

	test.each(["NaN", "undefined", "Infinity", "[object Object]", "Invalid Date"])("flags a visible %s", function broken(token) {
		expect(verdicts({ after: { ...calm, text: `Total ${token}` } }).noBrokenValues).toBe(`visible "${token}"`);
	});

	test("does not flag words that merely contain a token", function wordBoundary() {
		expect(verdicts({ after: { ...calm, text: "NaNa undefinedness Infinityx" } }).noBrokenValues).toBe(true);
	});

	test("ignores the app echoing what the explorer typed, but not other broken values", function echo() {
		expect(verdicts({ after: { ...calm, text: "Note: NaN" }, typed: ["NaN"] }).noBrokenValues).toBe(true);
		expect(verdicts({ after: { ...calm, text: "Note: NaN, total undefined" }, typed: ["NaN"] }).noBrokenValues).toBe('visible "undefined"');
	});

	test("an echo is only the typed text's own occurrence, not any later broken value", function echoSpan() {
		expect(isEcho("Note: NaN", 6, 3, ["NaN"])).toBe(true);
		expect(isEcho("Total $NaN", 7, 3, ["Note NaN"])).toBe(false);
		expect(verdicts({ after: { ...calm, text: "Note: hi NaN. Total $NaN" }, typed: ["hi NaN"] }).noBrokenValues).toBe('visible "NaN"');
	});

	test("console errors fail, except failed-load noise and ignored messages", function consoleErrors() {
		expect(verdicts({ consoleErrors: ["TypeError: x is undefined"] }).noConsoleErrors).toBe("console error: TypeError: x is undefined");
		expect(verdicts({ consoleErrors: ["Failed to load resource: the server responded with a status of 404"] }).noConsoleErrors).toBe(true);
		expect(verdicts({ consoleErrors: ["[MSW] Warning"] }, { ignoreConsole: /^\[MSW\]/u }).noConsoleErrors).toBe(true);
	});

	test("failed requests fail unless ignored", function requests() {
		expect(verdicts({ failedRequests: ["GET http://app/api: 500"] }).noFailedRequests).toBe("request failed: GET http://app/api: 500");
		expect(verdicts({ failedRequests: ["GET http://app/analytics: 503"] }, { ignoreRequests: /analytics/u }).noFailedRequests).toBe(true);
	});

	test("executed markup fails the injection property", function injected() {
		expect(verdicts({ after: { ...calm, injected: true } }).injectedTextStaysInert).toBe("typed markup executed");
	});

	test("Escape must close an open modal unless it is busy", function escape() {
		const open = { ...calm, modalOpen: true };

		expect(verdicts({ action: "press Escape", before: open, after: open }).escapeClosesDialogs).toBe("Escape left the modal open");
		expect(verdicts({ action: "press Escape", before: open, after: calm }).escapeClosesDialogs).toBe(true);
		expect(verdicts({ action: "press Escape", before: open, after: { ...open, busy: true } }).escapeClosesDialogs).toBe(true);
		expect(verdicts({ action: "press Enter", before: open, after: open }).escapeClosesDialogs).toBe(true);
		expect(verdicts({ action: "press Escape", before: calm, after: open }).escapeClosesDialogs).toBe(true);
	});

	test("an unsettled step fails the busy property", function busy() {
		expect(verdicts({ settled: false }).busyIndicatorsSettle).toMatch(/did not clear/u);
	});
});

describe("default commands", function commandsSuite() {
	test("generate clicks, typing, keys and waits with readable names", function kinds() {
		const names = fc.sample(fc.oneof(...defaultCommands()), { numRuns: 300, seed: 1 }).map(function describe(command: { toString(): string }) {
			return String(command).split(" ")[0];
		});

		expect(new Set(names)).toEqual(new Set(["click", "type", "press", "select", "wait"]));
	});

	test("typing draws from the hostile set, including markup that reports execution", function hostile() {
		expect(HOSTILE_TEXT).toContain("");
		expect(
			HOSTILE_TEXT.some(function reports(text: string) {
				return text.includes("__exploreInjected");
			}),
		).toBe(true);
		expect(KEYS).toContain("Escape");
	});

	test("accept overrides for keys and waits", function overrides() {
		const names = fc
			.sample(fc.oneof(...defaultCommands({ keys: ["F2"], waits: [5] })), { numRuns: 300, seed: 2 })
			.map(String)
			.filter(function keyOrWait(name: string) {
				return name.startsWith("press") || name.startsWith("wait");
			});

		expect(new Set(names)).toEqual(new Set(["press F2", "wait 5 ms"]));
	});
});

describe("the demo's time limit", function durationSuite() {
	test.each([
		["90", 90_000],
		["90s", 90_000],
		["2m", 120_000],
		["1.5m", 90_000],
		["500ms", 500],
	])("parses %s", function parses(text, ms) {
		expect(parseDuration(text)).toBe(ms);
	});

	test.each(["", "2h", "fast", "-5"])("rejects %j instead of running with no budget", function rejects(text) {
		expect(function parse() {
			return parseDuration(text);
		}).toThrow(/invalid duration/u);
	});
});
