import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { HOSTILE_TEXT, KEYS, defaultCommands, genericProperties } from "../skills/test-explore/assets/fast-check-explore.mjs";

type Snapshot = { text: string; modalOpen: boolean; busy: boolean; injected: boolean; app: unknown };

const calm: Snapshot = { text: "Cart $12.50", modalOpen: false, busy: false, injected: false, app: null };

/**
 * A step with sensible defaults, overridden per test.
 *
 * @param overrides - Fields to change.
 * @returns A step as the properties receive it.
 */
function step(overrides: Record<string, unknown> = {}) {
	return { action: "click button", before: calm, after: calm, errors: [], settled: true, typed: [], ...overrides };
}

/**
 * Verdicts of every generic property for one step, keyed by property name.
 *
 * @param overrides - Step fields to change.
 * @returns Property name to verdict.
 */
function verdicts(overrides: Record<string, unknown> = {}): Record<string, boolean | string> {
	return Object.fromEntries(
		genericProperties().map(function judge(property) {
			return [property.name, property.check(step(overrides) as Parameters<typeof property.check>[0])];
		}),
	);
}

describe("generic properties", function genericSuite() {
	test("a calm step passes every property", function calmStep() {
		expect(Object.values(verdicts())).toEqual([true, true, true, true, true]);
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

		expect(new Set(names)).toEqual(new Set(["click", "type", "press", "wait"]));
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
