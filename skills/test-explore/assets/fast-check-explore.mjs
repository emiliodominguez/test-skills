// Model-based UI exploration with fast-check and Playwright: random action sequences against a live
// page, properties checked after every action, failing sequences shrunk to the shortest that still
// fails, and every finding replayable from a seed and a path. Copy it into the repository; it needs
// `fast-check` and `playwright` (or `playwright-core`) as dev dependencies.
//
//   import { explore, genericProperties } from "./fast-check-explore.mjs";
//
//   const report = await explore({
//     browser,                                  // a launched Playwright browser
//     url: "http://127.0.0.1:4173/",
//     properties: [...genericProperties(), cartTotalAddsUp],
//     timeLimitMs: 120_000,
//   });
//
// Actions pick their target when they run (an index into what is on screen then), so a sequence is
// meaningful on any state and shrinks to a short, readable reproduction. Wall time is at most
// `timeLimitMs` plus, per finding, `shrinkMs` and one replay.

import fc from "fast-check";

/** Text that tends to break things: empty, edge numbers, unicode, markup that reports execution. */
export const HOSTILE_TEXT = [
	"",
	" ",
	"0",
	"-1",
	"1e309",
	"99999999999999999999",
	"0.1",
	"NaN",
	"😀👍🏽",
	"ﷺ",
	"Ω≈ç√",
	'"><img src=x onerror="window.__exploreInjected=1">',
	"<script>window.__exploreInjected=1</script>",
	"'; DROP TABLE users; --",
	"%s%n{0}",
	"a".repeat(300),
];

/** Keys worth pressing on any interface. */
export const KEYS = ["Escape", "Enter", "Tab", "Shift+Tab", " ", "ArrowDown", "ArrowUp"];

/** What counts as an open modal: native modal dialogs and ARIA modal dialogs. */
export const MODAL = 'dialog[open]:modal, [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]';

/** What counts as busy: `aria-busy` and indeterminate progress bars (no `aria-valuenow`). */
export const BUSY = '[aria-busy="true"], [role="progressbar"]:not([aria-valuenow])';

/** Elements a click may target. Links are limited to the page's origin when marked. */
export const CLICKABLE = [
	"button",
	"a[href]",
	"summary",
	'input[type="checkbox"]',
	'input[type="radio"]',
	'input[type="submit"]',
	'input[type="button"]',
	'input[type="reset"]',
	'input[type="image"]',
	'[role="button"]',
	'[role="link"]',
	'[role="tab"]',
	'[role="menuitem"]',
	'[role="menuitemcheckbox"]',
	'[role="menuitemradio"]',
	'[role="checkbox"]',
	'[role="switch"]',
	'[role="option"]',
	'[role="combobox"]',
	'[role="treeitem"]',
].join(", ");

/** Elements typing may target. */
export const TYPEABLE = [
	"input:not([type])",
	'input[type="text"]',
	'input[type="search"]',
	'input[type="email"]',
	'input[type="number"]',
	'input[type="tel"]',
	'input[type="url"]',
	'input[type="password"]',
	'input[type="date"]',
	'input[type="time"]',
	'input[type="datetime-local"]',
	"textarea",
	'[contenteditable]:not([contenteditable="false"])',
].join(", ");

/**
 * Snapshot of what any property may need, read in the page after an action settles.
 *
 * @typedef {object} Snapshot
 * @property {string} text - Visible body text.
 * @property {boolean} modalOpen - Whether a modal dialog is open.
 * @property {boolean} busy - Whether a busy indicator is visible.
 * @property {boolean} injected - Whether typed markup executed.
 * @property {unknown} app - What the app-specific `extract` returned.
 */

/**
 * One explored step, handed to every property.
 *
 * @typedef {object} Step
 * @property {string} action - Description of the action just taken ("load page" for the first state).
 * @property {Snapshot} before - State before the action.
 * @property {Snapshot} after - State after the action settled.
 * @property {string[]} errors - Uncaught page errors since the previous check.
 * @property {string[]} consoleErrors - Console errors since the previous check.
 * @property {string[]} failedRequests - Failed requests and 5xx responses since the previous check.
 * @property {boolean} settled - Whether busy indicators cleared within the settle budget.
 * @property {string[]} typed - Texts typed so far in this run, so properties can ignore echoes.
 */

/**
 * A rule checked after every action. `check` returns true when it holds, false or a message when
 * it does not, and null when the state cannot be judged yet (loading, the element absent): a null
 * counts as skipped in the report's `reach`, so a property that never had data is visible. A check
 * that throws counts as a violation of that property.
 *
 * @typedef {object} Property
 * @property {string} name - Name that reads as the rule.
 * @property {(step: Step) => boolean | string | null} check - The rule.
 */

/**
 * A violation, shrunk and ready to replay.
 *
 * @typedef {object} Finding
 * @property {string} property - Violated property, or "harness" when the harness itself failed.
 * @property {string} message - What the property reported.
 * @property {string[]} actions - Shrunk action sequence.
 * @property {number} seed - fast-check seed.
 * @property {string} path - fast-check path; with the seed and replay path, replays the shrunk case.
 * @property {string} replayPath - fast-check replay path of the shrunk command sequence.
 * @property {boolean} reproduced - Whether replaying the shrunk case violated the same property again.
 * @property {boolean} shrinkInterrupted - Whether the shrinking budget ran out, so the sequence may not be minimal.
 * @property {string} fingerprint - Identifies the command set; a replay with a different set is meaningless.
 */

/**
 * What the commands may target in the current state. Commands without a target are not applicable:
 * fast-check skips them when they would run and drops them when shrinking.
 *
 * @typedef {object} Model
 * @property {number} clickable - Clickable elements on screen.
 * @property {number} typeable - Text fields on screen.
 * @property {number} selectable - Select boxes on screen.
 */

/**
 * The real system a command runs against.
 *
 * @typedef {object} Real
 * @property {import("playwright-core").Page} page - The page.
 * @property {(page: import("playwright-core").Page) => Promise<unknown>} extract - App-specific reader.
 * @property {Property[]} properties - Properties to check.
 * @property {{ errors: string[], consoleErrors: string[], failedRequests: string[] }} events - Everything collected this run.
 * @property {{ errors: number, consoleErrors: number, failedRequests: number }} reported - How much of each list was checked already.
 * @property {number} settleMs - Settle budget per action.
 * @property {number} actionTimeoutMs - Timeout for one Playwright action.
 * @property {string[]} log - Descriptions of the actions taken so far in this run.
 * @property {string[]} typed - Texts typed so far in this run.
 * @property {Reach} reach - Judged and skipped counts per property, shared across runs.
 * @property {(page: import("playwright-core").Page) => Promise<object>} extendModel - Extra model fields.
 */

/**
 * How often each property had data to judge: `judged` steps returned a verdict, `skipped` steps
 * returned null. A property with no judged steps checked nothing.
 *
 * @typedef {Record<string, { judged: number, skipped: number }>} Reach
 */

/**
 * Read the generic snapshot. Runs in the page, so it is self-contained.
 *
 * @param {{ modal: string, busy: string }} selectors - Modal and busy selectors.
 * @returns {{ text: string, modalOpen: boolean, busy: boolean, injected: boolean }} Snapshot without the app part.
 */
export function readPage(selectors) {
	/**
	 * Whether an element is rendered and visible, fixed-position ones included.
	 *
	 * @param {Element} element - Element.
	 * @returns {boolean} Visible.
	 */
	function visible(element) {
		return element instanceof HTMLElement && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && element.getClientRects().length > 0;
	}

	return {
		text: document.body ? document.body.innerText : "",
		modalOpen: Array.from(document.querySelectorAll(selectors.modal)).some(visible),
		busy: Array.from(document.querySelectorAll(selectors.busy)).some(visible),
		injected: window.__exploreInjected === 1,
	};
}

/**
 * Mark the elements an action may target and return how many there are. Runs in the page. Inside an
 * open modal only the topmost modal's elements count, since everything else is inert or covered.
 *
 * @param {{ selector: string, modal: string }} query - Candidate and modal selectors.
 * @returns {number} Number of candidates, marked `data-explore-pick="0..n-1"`.
 */
export function markCandidates(query) {
	/**
	 * Whether an element is rendered and visible, fixed-position ones included.
	 *
	 * @param {Element} element - Element.
	 * @returns {boolean} Visible.
	 */
	function visible(element) {
		return element instanceof HTMLElement && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && element.getClientRects().length > 0;
	}

	/**
	 * Whether a link stays on this page's origin (other origins are out of scope for exploration).
	 *
	 * @param {Element} element - Candidate.
	 * @returns {boolean} Same origin, or not a link.
	 */
	function sameOrigin(element) {
		if (!(element instanceof HTMLAnchorElement)) return true;

		try {
			return new URL(element.href, location.href).origin === location.origin && !element.hasAttribute("download");
		} catch {
			return false;
		}
	}

	const scope = Array.from(document.querySelectorAll(query.modal)).filter(visible).at(-1) ?? document;
	const candidates = Array.from(scope.querySelectorAll(query.selector)).filter(function usable(element) {
		return visible(element) && !element.closest("[inert]") && !element.matches(":disabled") && element.getAttribute("aria-disabled") !== "true" && sameOrigin(element);
	});

	for (const element of document.querySelectorAll("[data-explore-pick]")) element.removeAttribute("data-explore-pick");
	candidates.forEach(function mark(element, index) {
		element.setAttribute("data-explore-pick", String(index));
	});

	return candidates.length;
}

/**
 * Count what the commands may target now.
 *
 * @param {import("playwright-core").Page} page - The page.
 * @returns {Promise<Model>} Targets on screen.
 */
async function targets(page) {
	return {
		clickable: await page.evaluate(markCandidates, { selector: CLICKABLE, modal: MODAL }),
		typeable: await page.evaluate(markCandidates, { selector: TYPEABLE, modal: MODAL }),
		selectable: await page.evaluate(markCandidates, { selector: "select", modal: MODAL }),
	};
}

/**
 * Wait until no busy indicator is visible, up to a budget. Two animation frames first, so an
 * indicator that appears just after the action is seen.
 *
 * @param {import("playwright-core").Page} page - The page.
 * @param {number} budgetMs - Longest wait.
 * @returns {Promise<boolean>} Whether the page settled.
 */
async function settle(page, budgetMs) {
	try {
		await page.evaluate(function twoFrames() {
			return new Promise(function frames(done) {
				requestAnimationFrame(function first() {
					requestAnimationFrame(done);
				});
			});
		});
		await page.waitForLoadState("domcontentloaded", { timeout: budgetMs });
		await page.waitForFunction(
			function idle(busy) {
				return !Array.from(document.querySelectorAll(busy)).some(function visible(element) {
					return element instanceof HTMLElement && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && element.getClientRects().length > 0;
				});
			},
			BUSY,
			{ timeout: budgetMs, polling: 50 },
		);

		return true;
	} catch {
		return false;
	}
}

/**
 * Error thrown from inside a run when a property fails, so the report can name it.
 */
class PropertyViolation extends Error {
	/**
	 * @param {string} property - Violated property.
	 * @param {string} detail - What it reported.
	 */
	constructor(property, detail) {
		super(`${property}: ${detail}`);
		this.property = property;
		this.detail = detail;
	}
}

/**
 * Take a snapshot of the page, retrying once when a navigation replaced the document mid-read.
 *
 * @param {Real} real - The system.
 * @returns {Promise<Snapshot>} Snapshot.
 */
async function snapshot(real) {
	for (let attempt = 0; ; attempt += 1) {
		try {
			const page = await real.page.evaluate(readPage, { modal: MODAL, busy: BUSY });

			return { ...page, app: await real.extract(real.page) };
		} catch (error) {
			if (attempt > 0 || !/context was destroyed|navigat/iu.test(String(error))) throw error;
			await real.page.waitForLoadState("domcontentloaded").catch(function ignore() {});
		}
	}
}

/**
 * Take the events collected since the previous check.
 *
 * @param {Real} real - The system.
 * @returns {{ errors: string[], consoleErrors: string[], failedRequests: string[] }} New events.
 */
function newEvents(real) {
	const fresh = {
		errors: real.events.errors.slice(real.reported.errors),
		consoleErrors: real.events.consoleErrors.slice(real.reported.consoleErrors),
		failedRequests: real.events.failedRequests.slice(real.reported.failedRequests),
	};

	real.reported = { errors: real.events.errors.length, consoleErrors: real.events.consoleErrors.length, failedRequests: real.events.failedRequests.length };

	return fresh;
}

/**
 * Check every property against one step. A property that throws counts as violated; a verdict that
 * is neither true, false nor a string is a bug in the property and is reported as one.
 *
 * @param {Real} real - The system.
 * @param {Step} current - The step.
 */
function check(real, current) {
	for (const property of real.properties) {
		let verdict;

		try {
			verdict = property.check(current);
		} catch (error) {
			throw new PropertyViolation(property.name, `check threw: ${error instanceof Error ? error.message : String(error)}`);
		}

		const counts = (real.reach[property.name] ??= { judged: 0, skipped: 0 });

		if (verdict === null) {
			counts.skipped += 1;
			continue;
		}

		counts.judged += 1;
		if (verdict === true) continue;
		if (verdict === false || typeof verdict === "string") throw new PropertyViolation(property.name, verdict === false ? "does not hold" : verdict);

		throw new PropertyViolation(property.name, `check returned ${typeof verdict}; return true, false, a message or null (async checks are not supported)`);
	}
}

/**
 * Run one action, then check every property against the step. Custom workflow commands call this
 * from their own `run(model, real)` so their steps are judged and the model stays current.
 *
 * @param {Model} model - Targets on screen; updated after the action.
 * @param {Real} real - The system.
 * @param {string} description - Action description.
 * @param {(page: import("playwright-core").Page) => Promise<void>} perform - The action.
 * @returns {Promise<void>} Resolves when every property holds; rejects with a violation otherwise.
 */
export async function runStep(model, real, description, perform) {
	const before = await snapshot(real);

	real.log.push(description);

	try {
		await perform(real.page);
	} catch {
		// An action that cannot apply (the target vanished or became inert) is a no-op, not a finding.
	}

	const settled = await settle(real.page, real.settleMs);
	const after = await snapshot(real);

	Object.assign(model, await targets(real.page), await real.extendModel(real.page));
	check(real, { action: description, before, after, ...newEvents(real), settled, typed: [...real.typed] });
}

/**
 * Short description of an action target: its accessible name or tag.
 *
 * @param {import("playwright-core").Locator} target - The element.
 * @param {number} timeoutMs - Longest wait for the element.
 * @returns {Promise<string>} Description.
 */
async function describeTarget(target, timeoutMs) {
	return target
		.evaluate(
			function describe(element) {
				const name = element.getAttribute("aria-label") ?? element.labels?.[0]?.textContent ?? element.textContent ?? element.getAttribute("value") ?? "";

				return `${element.tagName.toLowerCase()} "${name.trim().replace(/\s+/gu, " ").slice(0, 40)}"`;
			},
			undefined,
			{ timeout: timeoutMs },
		)
		.catch(function unknown() {
			return "an element";
		});
}

/**
 * Click the n-th clickable element on screen (modulo how many there are).
 */
export class Click {
	/** @param {number} pick - Target index. */
	constructor(pick) {
		this.pick = pick;
	}

	/**
	 * @param {Model} model - Targets on screen.
	 * @returns {boolean} Applicable while something is clickable; the target is resolved at run time.
	 */
	check(model) {
		return model.clickable > 0;
	}

	/**
	 * @param {Model} model - Targets on screen.
	 * @param {Real} real - The system.
	 * @returns {Promise<void>} Resolves after the step.
	 */
	async run(model, real) {
		const count = await real.page.evaluate(markCandidates, { selector: CLICKABLE, modal: MODAL });
		const target = count === 0 ? null : real.page.locator(`[data-explore-pick="${this.pick % count}"]`);
		const label = target ? await describeTarget(target, real.actionTimeoutMs) : "nothing";

		this.label = `click ${label}`;
		await runStep(model, real, this.label, async function perform() {
			if (target) await target.click({ timeout: real.actionTimeoutMs });
		});
	}

	/** @returns {string} Readable form for reports. */
	toString() {
		return this.label ?? `click #${this.pick}`;
	}
}

/**
 * Replace the value of the n-th text field with generated text.
 */
export class Type {
	/**
	 * @param {number} pick - Target index.
	 * @param {string} text - Text to enter.
	 */
	constructor(pick, text) {
		this.pick = pick;
		this.text = text;
	}

	/**
	 * @param {Model} model - Targets on screen.
	 * @returns {boolean} Applicable while a text field is on screen.
	 */
	check(model) {
		return model.typeable > 0;
	}

	/**
	 * @param {Model} model - Targets on screen.
	 * @param {Real} real - The system.
	 * @returns {Promise<void>} Resolves after the step.
	 */
	async run(model, real) {
		const count = await real.page.evaluate(markCandidates, { selector: TYPEABLE, modal: MODAL });
		const target = count === 0 ? null : real.page.locator(`[data-explore-pick="${this.pick % count}"]`);
		const label = target ? await describeTarget(target, real.actionTimeoutMs) : "nothing";
		const text = this.text;

		this.label = `type ${JSON.stringify(text.length > 40 ? `${text.slice(0, 40)}…` : text)} into ${label}`;
		await runStep(model, real, this.label, async function perform() {
			if (!target) return;
			await target.fill(text, { timeout: real.actionTimeoutMs });
			// Only text that actually went in can be echoed back.
			real.typed.push(text);
		});
	}

	/** @returns {string} Readable form for reports. */
	toString() {
		return this.label ?? `type ${JSON.stringify(this.text)} into #${this.pick}`;
	}
}

/**
 * Choose an option in the n-th select box.
 */
export class SelectOption {
	/**
	 * @param {number} pick - Target index.
	 * @param {number} option - Option index (modulo how many options there are).
	 */
	constructor(pick, option) {
		this.pick = pick;
		this.option = option;
	}

	/**
	 * @param {Model} model - Targets on screen.
	 * @returns {boolean} Applicable while a select box is on screen.
	 */
	check(model) {
		return model.selectable > 0;
	}

	/**
	 * @param {Model} model - Targets on screen.
	 * @param {Real} real - The system.
	 * @returns {Promise<void>} Resolves after the step.
	 */
	async run(model, real) {
		const count = await real.page.evaluate(markCandidates, { selector: "select", modal: MODAL });
		const target = count === 0 ? null : real.page.locator(`[data-explore-pick="${this.pick % count}"]`);
		const options = target
			? await target
					.evaluate(
						function optionCount(element) {
							return element instanceof HTMLSelectElement ? element.options.length : 0;
						},
						undefined,
						{ timeout: real.actionTimeoutMs },
					)
					.catch(function none() {
						return 0;
					})
			: 0;
		const index = options === 0 ? 0 : this.option % options;
		const label = target ? await describeTarget(target, real.actionTimeoutMs) : "nothing";

		this.label = `select option ${index} in ${label}`;
		await runStep(model, real, this.label, async function perform() {
			if (target && options > 0) await target.selectOption({ index }, { timeout: real.actionTimeoutMs });
		});
	}

	/** @returns {string} Readable form for reports. */
	toString() {
		return this.label ?? `select option ${this.option} in #${this.pick}`;
	}
}

/**
 * Press a key on whatever has focus.
 */
export class Press {
	/** @param {string} key - Key name. */
	constructor(key) {
		this.key = key;
	}

	/** @returns {boolean} Always applicable. */
	check() {
		return true;
	}

	/**
	 * @param {Model} model - Targets on screen.
	 * @param {Real} real - The system.
	 * @returns {Promise<void>} Resolves after the step.
	 */
	async run(model, real) {
		const key = this.key;

		await runStep(model, real, this.toString(), async function perform(page) {
			await page.keyboard.press(key);
		});
	}

	/** @returns {string} Readable form for reports. */
	toString() {
		return `press ${this.key}`;
	}
}

/**
 * Let time pass, for timers, debounces and slow responses.
 */
export class Wait {
	/** @param {number} ms - Milliseconds. */
	constructor(ms) {
		this.ms = ms;
	}

	/** @returns {boolean} Always applicable. */
	check() {
		return true;
	}

	/**
	 * @param {Model} model - Targets on screen.
	 * @param {Real} real - The system.
	 * @returns {Promise<void>} Resolves after the step.
	 */
	async run(model, real) {
		const ms = this.ms;

		await runStep(model, real, this.toString(), async function perform(page) {
			await page.waitForTimeout(ms);
		});
	}

	/** @returns {string} Readable form for reports. */
	toString() {
		return `wait ${this.ms} ms`;
	}
}

/**
 * Default command mix. Weights favor clicks, then typing and keys (Escape most of all); selects and
 * waits keep option lists and timers in play.
 *
 * @param {{ text?: fc.Arbitrary<string>, keys?: string[], waits?: number[] }} [options] - Overrides.
 * @returns {fc.Arbitrary<object>[]} Command arbitraries for `fc.commands`.
 */
export function defaultCommands(options = {}) {
	const text = options.text ?? fc.oneof({ weight: 3, arbitrary: fc.constantFrom(...HOSTILE_TEXT) }, { weight: 1, arbitrary: fc.string({ maxLength: 8 }) });
	const pick = fc.nat({ max: 50 });

	return [
		...Array.from({ length: 4 }, function clickWeight() {
			return pick.map(function click(index) {
				return new Click(index);
			});
		}),
		...Array.from({ length: 2 }, function typeWeight() {
			return fc.tuple(pick, text).map(function type([index, value]) {
				return new Type(index, value);
			});
		}),
		...Array.from({ length: 2 }, function pressWeight() {
			// Escape gets extra weight: dismissing dialogs and menus is where keyboard bugs cluster.
			const keys = options.keys
				? fc.constantFrom(...options.keys)
				: fc.oneof({ weight: 2, arbitrary: fc.constant("Escape") }, { weight: 3, arbitrary: fc.constantFrom(...KEYS) });

			return keys.map(function press(key) {
				return new Press(key);
			});
		}),
		fc.tuple(pick, fc.nat({ max: 20 })).map(function select([index, option]) {
			return new SelectOption(index, option);
		}),
		fc.constantFrom(...(options.waits ?? [100, 700])).map(function wait(ms) {
			return new Wait(ms);
		}),
	];
}

/**
 * Whether a match of a broken token lies inside text the explorer typed, which the app is merely
 * echoing back (a preview, a search term).
 *
 * @param {string} text - Visible text.
 * @param {number} index - Match start.
 * @param {number} length - Match length.
 * @param {string[]} typed - Texts typed this run.
 * @returns {boolean} True when the match is an echo.
 */
export function isEcho(text, index, length, typed) {
	return typed.some(function covers(value) {
		if (value.length < length) return false;

		for (let start = text.indexOf(value); start !== -1; start = text.indexOf(value, start + 1)) {
			if (start <= index && index + length <= start + value.length) return true;
		}

		return false;
	});
}

/**
 * Properties that hold for almost any interface.
 *
 * @param {{ ignoreConsole?: RegExp, ignoreRequests?: RegExp }} [options] - Messages and URLs known to be harmless.
 * @returns {Property[]} Generic properties.
 */
export function genericProperties(options = {}) {
	return [
		{
			name: "noUncaughtErrors",
			check: function noUncaughtErrors(step) {
				return step.errors.length === 0 || `uncaught: ${step.errors[0]}`;
			},
		},
		{
			name: "noConsoleErrors",
			check: function noConsoleErrors(step) {
				const errors = step.consoleErrors.filter(function relevant(message) {
					// Failed loads are judged by noFailedRequests; the browser logs them here too.
					return !/^Failed to load resource/u.test(message) && !(options.ignoreConsole?.test(message) ?? false);
				});

				return errors.length === 0 || `console error: ${errors[0]}`;
			},
		},
		{
			name: "noFailedRequests",
			check: function noFailedRequests(step) {
				const failed = step.failedRequests.filter(function relevant(entry) {
					return !(options.ignoreRequests?.test(entry) ?? false);
				});

				return failed.length === 0 || `request failed: ${failed[0]}`;
			},
		},
		{
			name: "noBrokenValues",
			check: function noBrokenValues(step) {
				const broken = [...step.after.text.matchAll(/\b(?:NaN|undefined|Infinity)\b|\[object Object\]|Invalid Date/gu)].find(function notEcho(match) {
					return !isEcho(step.after.text, match.index, match[0].length, step.typed);
				});

				return broken === undefined || `visible "${broken[0]}"`;
			},
		},
		{
			name: "injectedTextStaysInert",
			check: function injectedTextStaysInert(step) {
				return !step.after.injected || "typed markup executed";
			},
		},
		{
			name: "escapeClosesDialogs",
			check: function escapeClosesDialogs(step) {
				return !(step.action === "press Escape" && step.before.modalOpen && step.after.modalOpen && !step.after.busy) || "Escape left the modal open";
			},
		},
		{
			name: "busyIndicatorsSettle",
			check: function busyIndicatorsSettle(step) {
				return step.settled || "a busy indicator did not clear within the settle budget";
			},
		},
	];
}

/**
 * A run budget: once `until` passes, sequences are skipped (they pass without running), so fast-check
 * finishes quickly and no browser run is ever left going in the background.
 *
 * @typedef {object} Budget
 * @property {number} until - Epoch milliseconds after which runs are skipped.
 * @property {number} ran - Sequences actually run.
 * @property {Reach} reach - Judged and skipped counts per property during this budget's runs.
 */

/**
 * Which calls of a property run. Replay runs only the first call (the recorded case); shrinking runs
 * the rest only if the first call failed again, so it never wanders to a different failure.
 *
 * @typedef {object} Gate
 * @property {"all" | "first" | "after-first-fails"} mode - Which calls run.
 * @property {boolean} [firstPassed] - Set when the first call passed.
 * @property {string[]} [firstLog] - Actions of the first call.
 */

/**
 * The property fast-check checks: one sequence against a fresh page, skipped once the budget is spent
 * or when the gate says so (a skipped call passes without running).
 *
 * @param {Parameters<typeof explore>[0]} options - Exploration options.
 * @param {Property[]} properties - Properties to check.
 * @param {Budget} budget - Run budget.
 * @param {Gate} gate - Which calls run.
 * @param {string} [replayPath] - Replay path of a recorded finding.
 * @returns {fc.IAsyncPropertyWithHooks<[Iterable<object>]>} The property.
 */
function sequenceProperty(options, properties, budget, gate, replayPath) {
	let calls = 0;

	return fc.asyncProperty(sequences(options, replayPath), async function sequence(cmds) {
		const log = [];

		calls += 1;
		if (Date.now() >= budget.until) return;
		if (gate.mode === "first" && calls > 1) return;
		if (gate.mode === "after-first-fails" && calls > 1 && gate.firstPassed) return;
		if (calls === 1) gate.firstLog = log;
		budget.ran += 1;
		await runSequence(options, properties, cmds, log, budget.reach);
		if (calls === 1) gate.firstPassed = true;
	});
}

/**
 * Explore a page: run random action sequences, check the properties after each action, and shrink
 * each violation to a short sequence. With `keepGoing`, a violated property is set aside and the
 * search continues for the others until the time limit.
 *
 * @param {object} options - Exploration options.
 * @param {import("playwright-core").Browser} options.browser - Launched browser; a fresh context per run.
 * @param {string} options.url - Page to open at the start of every run.
 * @param {Property[]} options.properties - Properties to check.
 * @param {(page: import("playwright-core").Page) => Promise<unknown>} [options.extract] - App-specific state reader.
 * @param {fc.Arbitrary<object>[]} [options.commands] - Command arbitraries (default: `defaultCommands()`).
 * @param {number} [options.maxCommands] - Longest sequence (default 40).
 * @param {"small" | "medium" | "large"} [options.sequenceSize] - Typical sequence length (default "medium"; multi-step bugs need it).
 * @param {number} [options.numRuns] - Sequences per round (default 200).
 * @param {number} [options.timeLimitMs] - Search budget (default 2 minutes); time spent shrinking and replaying does not count against it.
 * @param {number} [options.shrinkMs] - Shrinking budget per finding, on top of the search budget (default 2 minutes).
 * @param {import("playwright-core").BrowserContextOptions} [options.contextOptions] - Options for each fresh context (viewport, locale, timezoneId, storageState).
 * @param {(page: import("playwright-core").Page) => Promise<void>} [options.setupPage] - Runs before the page loads: routes, init scripts, fakes.
 * @param {(page: import("playwright-core").Page) => Promise<object>} [options.extendModel] - Extra model fields read after each step, for workflow commands' `check(model)`.
 * @param {number} [options.settleMs] - Settle budget per action (default 3000).
 * @param {number} [options.actionTimeoutMs] - Timeout for one click, fill or select (default 1000).
 * @param {number} [options.seed] - Seed for the first round.
 * @param {boolean} [options.keepGoing] - Continue past the first finding.
 * @param {(finding: Finding) => void} [options.onFinding] - Called as each finding is shrunk.
 * @returns {Promise<{ findings: Finding[], runs: number, ms: number, seed: number, reach: Reach, fingerprint: string }>} Report; `runs` counts search sequences.
 */
export async function explore(options) {
	const timeLimitMs = options.timeLimitMs ?? 120_000;

	if (!Number.isFinite(timeLimitMs) || timeLimitMs <= 0) throw new Error(`timeLimitMs must be a positive number of milliseconds, got ${options.timeLimitMs}`);

	const started = Date.now();
	const search = { until: started + timeLimitMs, ran: 0, reach: {} };
	const findings = [];
	const skipped = new Set();
	const firstSeed = options.seed ?? Date.now() % 2 ** 31;
	const commandSet = fingerprint(options);
	let seed = firstSeed;

	while (Date.now() < search.until) {
		const active = options.properties.filter(function notFound(property) {
			return !skipped.has(property.name);
		});

		if (active.length === 0) break;

		// Search until the first failure without shrinking; the time spent shrinking and replaying is
		// added back to the search deadline below, so the time limit bounds only the search.
		const found = await fc.check(sequenceProperty(options, active, search, { mode: "all" }), { numRuns: options.numRuns ?? 200, seed, endOnFailure: true });

		if (!found.failed) {
			seed += 1;
			continue;
		}

		// Then shrink from that exact case with its own budget. If the case does not fail again on its
		// first rerun, nothing else is run, so the shrink cannot wander to a different failure.
		const paused = Date.now();
		const shrinkBudget = { until: paused + (options.shrinkMs ?? 120_000), ran: 0, reach: {} };
		const shrunk = await fc.check(sequenceProperty(options, active, shrinkBudget, { mode: "after-first-fails" }), {
			seed: found.seed,
			path: found.counterexamplePath ?? undefined,
		});
		const shrinkInterrupted = Date.now() >= shrinkBudget.until;
		const result = shrunk.failed ? shrunk : found;
		const violation = result.errorInstance instanceof PropertyViolation ? result.errorInstance : null;
		const property = violation?.property ?? "harness";
		const replayPath = /replayPath="([^"]*)"/u.exec(String(result.counterexample?.[0] ?? ""))?.[1] ?? "";
		const location = { seed: result.seed, path: result.counterexamplePath ?? "", replayPath };
		// A harness failure because the browser itself went away cannot be replayed; do not claim it.
		const replayable = options.browser.isConnected();
		const again = replayable
			? await replay(options, { ...location, property })
			: { failed: false, property: null, message: "browser closed", actions: gateLogFallback(result) };
		const finding = {
			property,
			message: violation?.detail ?? String(result.errorInstance),
			actions: again.actions,
			...location,
			reproduced: again.failed && again.property === property,
			shrinkInterrupted,
			fingerprint: commandSet,
		};

		search.until += Date.now() - paused;
		findings.push(finding);
		options.onFinding?.(finding);
		if (!options.keepGoing || !violation || !replayable) break;
		skipped.add(violation.property);
		seed += 1;
	}

	if (search.ran === 0 && findings.length === 0) throw new Error("no sequence ran within the time limit; raise timeLimitMs");

	return { findings, runs: search.ran, ms: Date.now() - started, seed: firstSeed, reach: search.reach, fingerprint: commandSet };
}

/**
 * Actions of a counterexample when it cannot be replayed: its commands' readable forms.
 *
 * @param {{ counterexample: unknown[] | null }} result - fast-check run details.
 * @returns {string[]} Actions, best effort.
 */
function gateLogFallback(result) {
	const commands = result.counterexample?.[0];

	return commands && typeof commands === "object" && Symbol.iterator in commands ? Array.from(/** @type {Iterable<object>} */ (commands), String) : [];
}

/**
 * Fingerprint of the command set: the first sequences it generates for a fixed seed. Adding,
 * removing or reweighting a command changes it, and so does a kit upgrade that changes the
 * defaults; a recorded seed and path only mean something under the same fingerprint.
 *
 * @param {Parameters<typeof explore>[0]} options - Exploration options.
 * @returns {string} Fingerprint.
 */
export function fingerprint(options) {
	const text = fc
		.sample(sequences(options), { seed: 1, numRuns: 5 })
		.map(function describe(cmds) {
			return Array.from(cmds, String).join(",");
		})
		.join("|");
	let hash = 2166136261;

	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 16777619) >>> 0;
	}

	return hash.toString(16).padStart(8, "0");
}

/**
 * Replay one finding: rerun exactly its shrunk sequence, once, in a fresh context, judged by the
 * finding's own property (all properties when it has none or was a harness failure).
 *
 * @param {Parameters<typeof explore>[0]} options - The options the finding was found with.
 * @param {{ seed: number, path: string, replayPath: string, property?: string, fingerprint?: string, actions?: string[] }} finding - A finding from the report.
 * @returns {Promise<{ failed: boolean, property: string | null, message: string, actions: string[], sameActions: boolean | null }>} Replay
 *   result; `sameActions` compares with the finding's recorded actions when it has them.
 */
export async function replay(options, finding) {
	if (finding.fingerprint && finding.fingerprint !== fingerprint(options)) {
		return {
			failed: false,
			property: null,
			message: "the command set differs from the one that recorded this finding (changed commands or kit version); its seed and path replay a different sequence",
			actions: [],
			sameActions: false,
		};
	}

	const judged = options.properties.filter(function own(property) {
		return property.name === finding.property;
	});
	const properties = judged.length > 0 ? judged : options.properties;
	const gate = { mode: "first" };
	const result = await fc.check(sequenceProperty(options, properties, { until: Number.POSITIVE_INFINITY, ran: 0, reach: {} }, gate, finding.replayPath), {
		seed: finding.seed,
		path: finding.path,
		endOnFailure: true,
	});
	const violation = result.errorInstance instanceof PropertyViolation ? result.errorInstance : null;

	return {
		failed: result.failed,
		property: result.failed ? (violation?.property ?? "harness") : null,
		message: result.failed ? String(violation?.detail ?? result.errorInstance) : "no longer fails",
		actions: gate.firstLog ?? [],
		sameActions: finding.actions ? JSON.stringify(finding.actions) === JSON.stringify(gate.firstLog ?? []) : null,
	};
}

/**
 * The sequence arbitrary. Exploration and replay must build it the same way, or a recorded path
 * means something else.
 *
 * @param {Parameters<typeof explore>[0]} options - Exploration options.
 * @param {string} [replayPath] - Replay path of a recorded finding.
 * @returns {fc.Arbitrary<Iterable<object>>} Command sequences.
 */
function sequences(options, replayPath) {
	return fc.commands(options.commands ?? defaultCommands(), {
		maxCommands: options.maxCommands ?? 40,
		size: options.sequenceSize ?? "medium",
		replayPath: replayPath || undefined,
	});
}

/**
 * Run one generated sequence in a fresh browser context: load the page, judge the loaded state,
 * then run the commands.
 *
 * @param {Parameters<typeof explore>[0]} options - Exploration options.
 * @param {Property[]} properties - Properties to check.
 * @param {Iterable<object>} cmds - Generated commands.
 * @param {string[]} [log] - Receives the description of each action taken.
 * @param {Reach} [reach] - Receives judged and skipped counts per property.
 * @returns {Promise<void>} Resolves when every step held.
 */
async function runSequence(options, properties, cmds, log = [], reach = {}) {
	const context = await options.browser.newContext(options.contextOptions);

	try {
		const page = await context.newPage();

		await options.setupPage?.(page);
		const actionTimeoutMs = options.actionTimeoutMs ?? 1000;
		const real = {
			page,
			extract:
				options.extract ??
				async function none() {
					return null;
				},
			properties,
			events: { errors: [], consoleErrors: [], failedRequests: [] },
			reported: { errors: 0, consoleErrors: 0, failedRequests: 0 },
			settleMs: options.settleMs ?? 3000,
			actionTimeoutMs,
			log,
			typed: [],
			reach,
			extendModel:
				options.extendModel ??
				async function noExtension() {
					return {};
				},
		};

		page.setDefaultTimeout(Math.max(5000, actionTimeoutMs * 5));
		page.on("pageerror", function collect(error) {
			real.events.errors.push(error.message);
		});
		page.on("console", function collect(message) {
			if (message.type() === "error") real.events.consoleErrors.push(message.text());
		});
		page.on("requestfailed", function collect(request) {
			const reason = request.failure()?.errorText ?? "failed";

			// Aborted requests are the browser cancelling work on navigation, not failures.
			if (!/ERR_ABORTED|NS_BINDING_ABORTED/u.test(reason)) real.events.failedRequests.push(`${request.method()} ${request.url()}: ${reason}`);
		});
		page.on("response", function collect(response) {
			if (response.status() >= 500) real.events.failedRequests.push(`${response.request().method()} ${response.url()}: ${response.status()}`);
		});
		page.on("dialog", function dismiss(dialog) {
			dialog.dismiss().catch(function ignore() {});
		});

		await page.goto(options.url);

		const settled = await settle(page, real.settleMs);
		const loaded = await snapshot(real);

		// The first state is judged too: errors during load must not vanish before the first action.
		check(real, { action: "load page", before: loaded, after: loaded, ...newEvents(real), settled, typed: [] });

		const model = { ...(await targets(page)), ...(await real.extendModel(page)) };

		await fc.asyncModelRun(function setup() {
			return { model, real };
		}, cmds);
	} finally {
		await context.close();
	}
}
