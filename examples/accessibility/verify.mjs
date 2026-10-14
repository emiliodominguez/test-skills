#!/usr/bin/env node
// Proves the claims of skills/test-accessibility on page.html, a small shop page whose bugs are
// switched on with `?bugs=a,b,c` (each one sits behind `seeded("name")` in the page):
//
//   - axe-core finds the automatable bugs on the seeded page, including two that exist only in a
//     state (an open dialog, a shown error), and nothing on the fixed page;
//   - a page carrying nine keyboard, semantics and layout bugs passes axe with zero violations,
//     and the browser checks below catch every one of them;
//   - every check passes on the fixed page;
//   - axe under jsdom reports colour contrast as "incomplete", not as a violation;
//   - a baseline of known violations fails only on new ones;
//   - a default axe run skips the WCAG 2.2 target-size rule; the `wcag22aa` tag turns it on.
//
//   CHROME=/path/to/chromium node examples/accessibility/verify.mjs
//
// Prints one line per claim and exits 0 only when all of them hold.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const { JSDOM, VirtualConsole } = require("jsdom");

const here = dirname(fileURLToPath(import.meta.url));
const PAGE_FILE = join(here, "page.html");
const PAGE_URL = pathToFileURL(PAGE_FILE).href;
const AXE_PATH = require.resolve("axe-core");

/** WCAG 2.0, 2.1 and 2.2 level A and AA rules. axe-core 4.14 has no `wcag22a` tag. */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** Bugs a rule engine can decide from the DOM and computed styles. */
const AXE_BUGS = ["icon-name", "img-alt", "field-label", "dialog-label", "contrast"];

/** Bugs that need interaction, the accessibility tree, a viewport or a media setting to see. */
const BEYOND_AXE_BUGS = [
	"div-button",
	"focus-outline",
	"modal-trap",
	"modal-escape",
	"focus-return",
	"error-link",
	"live-region",
	"reflow",
	"motion",
];

/** Test ids of every control, in reading order. */
const CONTROLS_IN_ORDER = ["menu", "add", "email", "subscribe", "delete"];

/** Text of the newsletter field's error. */
const EMAIL_ERROR = "Enter an email address, like name@example.com.";

/**
 * One axe violation, flattened to what a report or a baseline needs.
 *
 * @typedef {object} Violation
 * @property {string} rule - axe rule id.
 * @property {string} target - CSS selector of the failing node.
 */

/**
 * Result of one browser check.
 *
 * @typedef {object} Outcome
 * @property {boolean} pass - Whether the check held.
 * @property {string} detail - What was observed.
 */

/**
 * A check that axe cannot make: it drives the page or reads the browser's accessibility tree.
 *
 * @typedef {object} BrowserCheck
 * @property {string} name - Name that reads as the rule.
 * @property {string} bug - The seeded bug it must catch.
 * @property {string} wcag - Success criterion it covers.
 * @property {Record<string, unknown>} [pageOptions] - Options for `browser.newPage`.
 * @property {(page: import("playwright-core").Page) => Promise<Outcome>} run - The check.
 */

/** Claims checked so far, and how many failed. */
const tally = { total: 0, failed: 0 };

/**
 * Print one claim and count it.
 *
 * @param {boolean} holds - Whether the claim held.
 * @param {string} claim - The claim, as a sentence.
 * @param {string} [detail] - Evidence printed after the claim.
 */
function report(holds, claim, detail) {
	tally.total += 1;
	if (!holds) tally.failed += 1;
	console.log(`${holds ? "ok  " : "FAIL"}  ${claim}${detail ? ` (${detail})` : ""}`);
}

/**
 * URL of the page with a set of bugs seeded.
 *
 * @param {string[]} bugs - Bug names.
 * @returns {string} File URL with the `bugs` query.
 */
function pageUrl(bugs) {
	return `${PAGE_URL}?bugs=${bugs.join(",")}`;
}

/**
 * Open a fresh page with the given bugs.
 *
 * @param {import("playwright-core").Browser} browser - The browser.
 * @param {string[]} bugs - Bug names.
 * @param {Record<string, unknown>} [options] - Options for `browser.newPage`.
 * @returns {Promise<import("playwright-core").Page>} The loaded page.
 */
async function openPage(browser, bugs, options = {}) {
	const page = await browser.newPage(options);

	page.setDefaultTimeout(5000);
	await page.goto(pageUrl(bugs));

	return page;
}

/**
 * Run axe-core in the page against WCAG A and AA rules. Runs in the page.
 *
 * @param {string[]} tags - axe rule tags.
 * @returns {Promise<Violation[]>} One entry per failing node.
 */
async function runAxeInPage(tags) {
	const results = await window.axe.run(document, { runOnly: { type: "tag", values: tags } });
	const flat = [];

	for (const violation of results.violations) {
		for (const node of violation.nodes) flat.push({ rule: violation.id, target: node.target.join(" ") });
	}

	return flat;
}

/**
 * Inject axe-core once and scan the page as it is now.
 *
 * @param {import("playwright-core").Page} page - The page.
 * @returns {Promise<Violation[]>} Violations.
 */
async function scan(page) {
	const injected = await page.evaluate(function hasAxe() {
		return typeof window.axe !== "undefined";
	});

	if (!injected) await page.addScriptTag({ path: AXE_PATH });

	return page.evaluate(runAxeInPage, WCAG_TAGS);
}

/**
 * Scan the page in each state a user can reach: as loaded, with the dialog open, with an error shown.
 *
 * @param {import("playwright-core").Browser} browser - The browser.
 * @param {string[]} bugs - Bug names.
 * @returns {Promise<Record<"initial" | "dialog" | "error", Violation[]>>} Violations per state.
 */
async function scanEveryState(browser, bugs) {
	const page = await openPage(browser, bugs);

	try {
		const initial = await scan(page);

		await page.click('[data-testid="delete"]');
		await page.waitForSelector('[data-testid="dialog"]', { state: "visible" });
		const dialog = await scan(page);

		await page.click('[data-testid="cancel"]');
		await page.click('[data-testid="subscribe"]');
		await page.waitForSelector('[data-testid="email-error"]', { state: "visible" });
		const error = await scan(page);

		return { initial, dialog, error };
	} finally {
		await page.close();
	}
}

/**
 * Stable key for a violation, used to compare scans and baselines.
 *
 * @param {Violation} violation - A violation.
 * @returns {string} `rule target`.
 */
function fingerprint(violation) {
	return `${violation.rule} ${violation.target}`;
}

/**
 * Compare a scan against a recorded baseline of known violations.
 *
 * @param {string[]} baseline - Recorded fingerprints.
 * @param {Violation[]} current - Violations found now.
 * @returns {{ added: string[], resolved: string[] }} New violations (fail the build) and fixed ones (shrink the baseline).
 */
function diffAgainstBaseline(baseline, current) {
	const now = new Set(current.map(fingerprint));
	const known = new Set(baseline);

	return {
		added: [...now].filter(function isNew(key) {
			return !known.has(key);
		}),
		resolved: [...known].filter(function isGone(key) {
			return !now.has(key);
		}),
	};
}

/**
 * Describe the focused element and whether it shows a focus indicator. Runs in the page.
 *
 * @returns {{ id: string, indicator: boolean } | null} Null when focus left the document.
 */
function readFocus() {
	const element = document.activeElement;

	if (!element || element === document.body) return null;

	const style = getComputedStyle(element);
	const outline = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
	const shadow = style.boxShadow !== "none";

	return { id: element.getAttribute("data-testid") || element.tagName.toLowerCase(), indicator: outline || shadow };
}

/**
 * Press Tab from the top of the page until focus leaves the document, recording every stop.
 *
 * @param {import("playwright-core").Page} page - A freshly loaded page.
 * @returns {Promise<Array<{ id: string, indicator: boolean }>>} Tab stops in order.
 */
async function tabWalk(page) {
	const stops = [];

	for (let press = 0; press < 20; press += 1) {
		await page.keyboard.press("Tab");
		const focus = await page.evaluate(readFocus);

		if (!focus) break;
		stops.push(focus);
	}

	return stops;
}

/**
 * Whether focus is inside the confirmation dialog. Runs in the page.
 *
 * @returns {string} `inside`, or the test id or tag of the element outside that holds focus.
 */
function focusLocation() {
	const element = document.activeElement;

	if (document.querySelector('[data-testid="dialog"]').contains(element)) return "inside";

	return element ? element.getAttribute("data-testid") || element.tagName.toLowerCase() : "none";
}

/**
 * Open the dialog the way a keyboard user does: focus its trigger and press Enter.
 *
 * @param {import("playwright-core").Page} page - The page.
 */
async function openDialogByKeyboard(page) {
	await page.focus('[data-testid="delete"]');
	await page.keyboard.press("Enter");
	await page.waitForSelector('[data-testid="dialog"]', { state: "visible" });
}

/**
 * Read one node of the browser's accessibility tree through the Chrome DevTools Protocol.
 *
 * @param {import("playwright-core").Page} page - The page.
 * @param {string} selector - CSS selector of the element.
 * @returns {Promise<{ role: string, name: string, description: string, properties: Record<string, unknown> }>} The node.
 */
async function accessibilityNode(page, selector) {
	const cdp = await page.context().newCDPSession(page);

	try {
		const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
		const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector });
		const { nodes } = await cdp.send("Accessibility.getPartialAXTree", { nodeId, fetchRelatives: false });
		const node = nodes[0] ?? {};
		const properties = {};

		for (const property of node.properties ?? []) properties[property.name] = property.value?.value;

		return {
			role: node.role?.value ?? "",
			name: node.name?.value ?? "",
			description: node.description?.value ?? "",
			properties,
		};
	} finally {
		await cdp.detach();
	}
}

/**
 * Number of animations running in the document. Runs in the page.
 *
 * @returns {number} Running animations.
 */
function runningAnimations() {
	return document.getAnimations().filter(function running(animation) {
		return animation.playState === "running";
	}).length;
}

/**
 * Horizontal overflow of the document in CSS pixels. Runs in the page.
 *
 * @returns {number} How far the content is wider than the viewport.
 */
function horizontalOverflow() {
	return document.documentElement.scrollWidth - window.innerWidth;
}

/**
 * Tab reaches every control, in reading order.
 *
 * @param {import("playwright-core").Page} page - The page.
 * @returns {Promise<Outcome>} Outcome.
 */
async function tabReachesEveryControl(page) {
	const order = (await tabWalk(page)).map(function toId(stop) {
		return stop.id;
	});
	const reached = order.filter(function isControl(id) {
		return CONTROLS_IN_ORDER.includes(id);
	});

	return { pass: reached.join(",") === CONTROLS_IN_ORDER.join(","), detail: `tab order: ${order.join(" > ")}` };
}

/**
 * Every tab stop shows a focus indicator.
 *
 * @param {import("playwright-core").Page} page - The page.
 * @returns {Promise<Outcome>} Outcome.
 */
async function focusIsVisible(page) {
	const stops = await tabWalk(page);
	const hidden = stops
		.filter(function noIndicator(stop) {
			return !stop.indicator;
		})
		.map(function toId(stop) {
			return stop.id;
		});

	return {
		pass: stops.length > 0 && hidden.length === 0,
		detail: hidden.length > 0 ? `no indicator on ${hidden.join(", ")}` : `${stops.length} stops`,
	};
}

/**
 * Opening the dialog moves focus into it, and Tab and Shift+Tab never leave it.
 *
 * @param {import("playwright-core").Page} page - The page.
 * @returns {Promise<Outcome>} Outcome.
 */
async function dialogTrapsFocus(page) {
	await openDialogByKeyboard(page);
	const onOpen = await page.evaluate(focusLocation);

	if (onOpen !== "inside") return { pass: false, detail: `focus stayed on ${onOpen} after opening` };

	for (const key of ["Tab", "Tab", "Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"]) {
		await page.keyboard.press(key);
		const where = await page.evaluate(focusLocation);

		if (where !== "inside") return { pass: false, detail: `${key} moved focus to ${where}` };
	}

	return { pass: true, detail: "11 presses stayed inside" };
}

/**
 * Escape closes the dialog.
 *
 * @param {import("playwright-core").Page} page - The page.
 * @returns {Promise<Outcome>} Outcome.
 */
async function escapeClosesDialog(page) {
	await openDialogByKeyboard(page);
	await page.keyboard.press("Escape");
	const open = await page.isVisible('[data-testid="dialog"]');

	return { pass: !open, detail: open ? "dialog still open" : "dialog closed" };
}

/**
 * Closing the dialog returns focus to the control that opened it.
 *
 * @param {import("playwright-core").Page} page - The page.
 * @returns {Promise<Outcome>} Outcome.
 */
async function focusReturnsToOpener(page) {
	await openDialogByKeyboard(page);
	await page.click('[data-testid="cancel"]');
	const focus = await page.evaluate(readFocus);
	const where = focus ? focus.id : "body";

	return { pass: where === "delete", detail: `focus on ${where}` };
}

/**
 * After a failed submit the field is invalid and its accessible description is the error.
 *
 * @param {import("playwright-core").Page} page - The page.
 * @returns {Promise<Outcome>} Outcome.
 */
async function errorIsTiedToField(page) {
	await page.focus('[data-testid="email"]');
	await page.keyboard.press("Enter");
	await page.waitForSelector('[data-testid="email-error"]', { state: "visible" });
	const node = await accessibilityNode(page, '[data-testid="email"]');
	const invalid = node.properties.invalid === "true";

	return {
		pass: invalid && node.description === EMAIL_ERROR,
		detail: `invalid=${node.properties.invalid}, description="${node.description}"`,
	};
}

/**
 * The cart confirmation is written into a live region that existed before the update.
 *
 * @param {import("playwright-core").Page} page - The page.
 * @returns {Promise<Outcome>} Outcome.
 */
async function updatesAreAnnounced(page) {
	const before = await accessibilityNode(page, '[data-testid="status"]');

	await page.click('[data-testid="add"]');
	const text = await page.textContent('[data-testid="status"]');
	const live = before.properties.live;

	return {
		pass: (live === "polite" || live === "assertive") && /Added/.test(text ?? ""),
		detail: `live=${live ?? "none"}, text="${text}"`,
	};
}

/**
 * At 320 CSS pixels wide (400% zoom of a 1280-pixel window) nothing scrolls sideways.
 *
 * @param {import("playwright-core").Page} page - The page, opened at 320 by 640.
 * @returns {Promise<Outcome>} Outcome.
 */
async function reflowsAt320(page) {
	const overflow = await page.evaluate(horizontalOverflow);

	return { pass: overflow <= 1, detail: `overflow ${overflow}px` };
}

/**
 * With reduced motion requested, nothing animates.
 *
 * @param {import("playwright-core").Page} page - The page, opened with `reducedMotion: "reduce"`.
 * @returns {Promise<Outcome>} Outcome.
 */
async function honorsReducedMotion(page) {
	const running = await page.evaluate(runningAnimations);

	return { pass: running === 0, detail: `${running} running animations` };
}

/** Checks axe cannot make, each paired with the seeded bug it must catch. */
const BROWSER_CHECKS = [
	{ name: "tabReachesEveryControl", bug: "div-button", wcag: "2.1.1", run: tabReachesEveryControl },
	{ name: "focusIsVisible", bug: "focus-outline", wcag: "2.4.7", run: focusIsVisible },
	{ name: "dialogTrapsFocus", bug: "modal-trap", wcag: "2.4.3", run: dialogTrapsFocus },
	{ name: "escapeClosesDialog", bug: "modal-escape", wcag: "2.1.1", run: escapeClosesDialog },
	{ name: "focusReturnsToOpener", bug: "focus-return", wcag: "2.4.3", run: focusReturnsToOpener },
	{ name: "errorIsTiedToField", bug: "error-link", wcag: "3.3.1, 1.3.1", run: errorIsTiedToField },
	{ name: "updatesAreAnnounced", bug: "live-region", wcag: "4.1.3", run: updatesAreAnnounced },
	{ name: "reflowsAt320", bug: "reflow", wcag: "1.4.10", pageOptions: { viewport: { width: 320, height: 640 } }, run: reflowsAt320 },
	{ name: "honorsReducedMotion", bug: "motion", wcag: "2.2.2", pageOptions: { reducedMotion: "reduce" }, run: honorsReducedMotion },
];

/**
 * Run one browser check on a fresh page.
 *
 * @param {import("playwright-core").Browser} browser - The browser.
 * @param {BrowserCheck} check - The check.
 * @param {string[]} bugs - Bug names to seed.
 * @returns {Promise<Outcome>} Outcome; a thrown error counts as a failed check.
 */
async function runCheck(browser, check, bugs) {
	const page = await openPage(browser, bugs, check.pageOptions);

	try {
		return await check.run(page);
	} catch (error) {
		return { pass: false, detail: `threw: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}` };
	} finally {
		await page.close();
	}
}

/**
 * Rule ids in a list of violations, sorted and unique.
 *
 * @param {Violation[]} violations - Violations.
 * @returns {string[]} Rule ids.
 */
function rulesOf(violations) {
	return [
		...new Set(
			violations.map(function toRule(violation) {
				return violation.rule;
			}),
		),
	].sort();
}

/**
 * Violations in a state scan that the initial scan did not report.
 *
 * @param {Violation[]} state - Violations in the state.
 * @param {Violation[]} initial - Violations on load.
 * @returns {string[]} Fingerprints only the state has.
 */
function onlyIn(state, initial) {
	const known = new Set(initial.map(fingerprint));

	return state.map(fingerprint).filter(function isNew(key) {
		return !known.has(key);
	});
}

/**
 * Run axe-core under jsdom on the seeded page, as a component test runner would.
 *
 * @param {string[]} bugs - Bug names.
 * @returns {Promise<{ violations: string[], incomplete: string[] }>} Rule ids by outcome.
 */
async function scanInJsdom(bugs) {
	const dom = new JSDOM(readFileSync(PAGE_FILE, "utf8"), {
		url: pageUrl(bugs),
		runScripts: "dangerously",
		pretendToBeVisual: true,
		virtualConsole: new VirtualConsole(),
	});

	try {
		dom.window.eval(readFileSync(AXE_PATH, "utf8"));
		const results = await dom.window.axe.run(dom.window.document, { runOnly: { type: "tag", values: WCAG_TAGS } });

		return {
			violations: results.violations.map(function toId(result) {
				return result.id;
			}),
			incomplete: results.incomplete.map(function toId(result) {
				return result.id;
			}),
		};
	} finally {
		dom.window.close();
	}
}

/**
 * Run axe twice in the page, with its defaults and with the WCAG tags. Runs in the page.
 *
 * @param {string[]} tags - axe rule tags.
 * @returns {Promise<{ byDefault: string[], withTags: string[] }>} Violated rule ids per run.
 */
async function runAxeTwiceInPage(tags) {
	/**
	 * Rule ids of a result's violations.
	 *
	 * @param {{ violations: Array<{ id: string }> }} results - axe results.
	 * @returns {string[]} Rule ids.
	 */
	function violatedRules(results) {
		return results.violations.map(function toId(violation) {
			return violation.id;
		});
	}

	return {
		byDefault: violatedRules(await window.axe.run(document)),
		withTags: violatedRules(await window.axe.run(document, { runOnly: { type: "tag", values: tags } })),
	};
}

/**
 * Scan two 16-pixel icon buttons two pixels apart: too small for 2.5.8 Target Size (Minimum).
 *
 * @param {import("playwright-core").Browser} browser - The browser.
 * @returns {Promise<{ byDefault: string[], withTags: string[] }>} Violated rule ids per run.
 */
async function scanSmallTargets(browser) {
	const page = await browser.newPage();

	try {
		await page.setContent(
			'<!doctype html><html lang="en"><title>Pager</title><main><h1>Pager</h1><div style="display:flex;gap:2px">' +
				'<button aria-label="Previous" style="width:16px;height:16px;padding:0"></button>' +
				'<button aria-label="Next" style="width:16px;height:16px;padding:0"></button></div></main></html>',
		);
		await page.addScriptTag({ path: AXE_PATH });

		return await page.evaluate(runAxeTwiceInPage, WCAG_TAGS);
	} finally {
		await page.close();
	}
}

/**
 * Check every claim and set the exit code.
 */
async function main() {
	const browser = await chromium.launch({ executablePath: process.env.CHROME || "/opt/pw-browsers/chromium" });
	const allBugs = [...AXE_BUGS, ...BEYOND_AXE_BUGS];

	try {
		const seeded = await scanEveryState(browser, allBugs);
		const seededRules = rulesOf(seeded.initial);
		const dialogOnly = onlyIn(seeded.dialog, seeded.initial);
		const errorOnly = onlyIn(seeded.error, seeded.initial);

		report(
			seededRules.join(",") === "button-name,color-contrast,image-alt,label",
			"axe finds the unnamed icon button, missing alt, unlabelled field and low contrast on load",
			seeded.initial.map(fingerprint).join("; "),
		);
		report(
			dialogOnly.join(",") === "label #confirm-text",
			"axe finds the unlabelled dialog field only when the dialog is open",
			dialogOnly.join("; ") || "nothing new",
		);
		report(
			errorOnly.join(",") === "color-contrast #email-error",
			"axe finds the low-contrast error text only when the error is shown",
			errorOnly.join("; ") || "nothing new",
		);

		const beyond = await scanEveryState(browser, BEYOND_AXE_BUGS);
		const beyondCount = beyond.initial.length + beyond.dialog.length + beyond.error.length;

		report(
			beyondCount === 0,
			`axe reports zero violations on a page seeded with ${BEYOND_AXE_BUGS.length} keyboard, semantics and layout bugs`,
			`initial ${beyond.initial.length}, dialog ${beyond.dialog.length}, error ${beyond.error.length}`,
		);

		for (const check of BROWSER_CHECKS) {
			const outcome = await runCheck(browser, check, [check.bug]);

			report(!outcome.pass, `${check.name} (${check.wcag}) catches ${check.bug}, which axe missed`, outcome.detail);
		}

		const failingOnSeeded = [];

		for (const check of BROWSER_CHECKS) {
			const outcome = await runCheck(browser, check, allBugs);

			if (!outcome.pass) failingOnSeeded.push(check.name);
		}
		report(
			failingOnSeeded.length === BROWSER_CHECKS.length,
			`all ${BROWSER_CHECKS.length} browser checks also fail with every bug seeded at once`,
			`${failingOnSeeded.length} failed`,
		);

		const fixed = await scanEveryState(browser, []);

		report(
			fixed.initial.length + fixed.dialog.length + fixed.error.length === 0,
			"axe reports zero violations on the fixed page in every state",
			`initial ${fixed.initial.length}, dialog ${fixed.dialog.length}, error ${fixed.error.length}`,
		);

		for (const check of BROWSER_CHECKS) {
			const outcome = await runCheck(browser, check, []);

			report(outcome.pass, `${check.name} passes on the fixed page`, outcome.detail);
		}

		const baselinePage = await openPage(browser, ["icon-name", "img-alt"]);
		const baseline = (await scan(baselinePage)).map(fingerprint);

		await baselinePage.close();
		const changedPage = await openPage(browser, ["icon-name", "field-label"]);
		const diff = diffAgainstBaseline(baseline, await scan(changedPage));

		await changedPage.close();
		report(
			diff.added.join(",") === "label #email" && diff.resolved.join(",") === "image-alt img",
			"a baseline of known violations fails only on the new one and reports the fixed one",
			`added: ${diff.added.join("; ")}; resolved: ${diff.resolved.join("; ")}`,
		);

		const targets = await scanSmallTargets(browser);

		report(
			!targets.byDefault.includes("target-size") && targets.withTags.includes("target-size"),
			"a default axe run skips target-size (2.5.8); the wcag22aa tag catches two 16px buttons",
			`default: ${targets.byDefault.join(", ") || "none"}; with tags: ${targets.withTags.join(", ")}`,
		);
	} finally {
		await browser.close();
	}

	const jsdom = await scanInJsdom(AXE_BUGS);

	report(
		!jsdom.violations.includes("color-contrast") && jsdom.incomplete.includes("color-contrast"),
		"axe under jsdom reports low contrast as incomplete, not as a violation",
		`violations: ${jsdom.violations.join(", ")}; incomplete: ${jsdom.incomplete.join(", ")}`,
	);

	console.log(`\n${tally.total - tally.failed}/${tally.total} accessibility claims hold.`);
	process.exitCode = tally.failed > 0 ? 1 : 0;
}

await main();
