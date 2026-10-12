import { describe, expect, test } from "vitest";
import { applyPolicy, describeAction, locateChrome, parseArgs, renderSummary, summarizeTrace } from "../skills/test-bombadil/assets/bombadil-run.mjs";

const trace = [
	{ action: null, state: { url: "http://app/" }, violations: [] },
	{
		action: { Click: { fingerprint: { test_id: "button||Pay|0", tag: "button" } } },
		state: { url: "http://app/" },
		violations: [{ name: "cartTotalAddsUp" }],
	},
	{
		action: { TypeText: { text: "<img id=bmbxss>" } },
		state: { url: "http://app/" },
		violations: [{ name: "cartTotalAddsUp" }, { name: "injectedTextStaysInert" }],
	},
	{ action: "Wait", state: { url: "http://app/" }, violations: [{ name: "noSeriousAccessibilityIssues" }] },
];

describe("parseArgs", function parseArgsSuite() {
	test("reads values, flags and passthrough arguments", function reads() {
		expect(parseArgs(["--origin", "http://x/", "--keep-going", "--", "--width", "390"])).toEqual({
			origin: "http://x/",
			"keep-going": true,
			passthrough: ["--width", "390"],
		});
	});

	test.each([[["stray"]], [["--origin"]]])("rejects %j", function rejects(argv) {
		expect(function parse() {
			parseArgs(argv);
		}).toThrow();
	});
});

describe("summarizeTrace", function summarizeSuite() {
	test("groups violations by property with the first step and action", function groups() {
		expect(summarizeTrace(trace)).toEqual([
			{ property: "cartTotalAddsUp", count: 2, firstStep: 1, firstAction: 'Click "button||Pay|0"', url: "http://app/" },
			{ property: "injectedTextStaysInert", count: 1, firstStep: 2, firstAction: 'type "<img id=bmbxss>"', url: "http://app/" },
			{ property: "noSeriousAccessibilityIssues", count: 1, firstStep: 3, firstAction: "Wait", url: "http://app/" },
		]);
	});
});

describe("applyPolicy", function policySuite() {
	const findings = summarizeTrace(trace);
	const policy = {
		default: "stop",
		properties: { noSeriousAccessibilityIssues: "record" },
		known: [
			{ property: "injectedTextStaysInert", until: "2026-12-31", reason: "tracked" },
			{ property: "cartTotalAddsUp", until: "2026-01-01", reason: "expired" },
		],
	};

	test("stops on deciding properties, records measurements and live known findings", function decides() {
		expect(
			applyPolicy(findings, policy, "2026-10-12").map(function verdictOf(finding: { property: string; verdict: string }) {
				return [finding.property, finding.verdict];
			}),
		).toEqual([
			["cartTotalAddsUp", "stop"],
			["injectedTextStaysInert", "record"],
			["noSeriousAccessibilityIssues", "record"],
		]);
	});

	test("an expired known finding fails again", function expires() {
		expect(applyPolicy(findings, policy, "2027-01-01")[0]?.verdict).toBe("stop");
	});
});

describe("reporting helpers", function helpers() {
	test("describeAction names keys and plain actions", function describes() {
		expect([describeAction({ PressKey: { code: 27 } }), describeAction("Back"), describeAction(null)]).toEqual(["key 27", "Back", "start"]);
	});

	test("renderSummary escapes table pipes and says when nothing was found", function renders() {
		const clean = renderSummary({ setup: { origin: "http://app/" }, states: 10, verdicts: [], reproduce: "x" });
		const found = renderSummary({
			setup: { origin: "http://app/" },
			states: 4,
			verdicts: applyPolicy(summarizeTrace(trace), {}, "2026-10-12"),
			reproduce: "x",
		});

		expect(clean).toContain("No findings.");
		expect(found).toContain('| cartTotalAddsUp | stop | 2 | 1 | Click "button\\|\\|Pay\\|0" |');
	});

	test("locateChrome prefers the CHROME variable", function chrome() {
		expect(locateChrome({ CHROME: "/opt/chrome" })).toBe("/opt/chrome");
	});
});
