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
// meaningful on any state and shrinks to a short, readable reproduction.

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
 * @property {string} action - Description of the action just taken.
 * @property {Snapshot} before - State before the action.
 * @property {Snapshot} after - State after the action settled.
 * @property {string[]} errors - Uncaught page errors raised during the action.
 * @property {boolean} settled - Whether busy indicators cleared within the settle budget.
 * @property {string[]} typed - Every text typed so far in this run, so properties can ignore echoes.
 */

/**
 * A rule checked after every action. `check` returns true when it holds, or false or a message
 * when it does not.
 *
 * @typedef {object} Property
 * @property {string} name - Name that reads as the rule.
 * @property {(step: Step) => boolean | string} check - The rule.
 */

/**
 * A violation, shrunk and ready to replay.
 *
 * @typedef {object} Finding
 * @property {string} property - Violated property.
 * @property {string} message - What the property reported.
 * @property {string[]} actions - Shrunk action sequence.
 * @property {number} seed - fast-check seed.
 * @property {string} path - fast-check path; with the seed and replay path, replays the shrunk case.
 * @property {string} replayPath - fast-check replay path of the shrunk command sequence.
 * @property {boolean} reproduced - Whether replaying the shrunk case failed again the same way.
 */

/**
 * Read the generic snapshot. Runs in the page.
 *
 * @returns {{ text: string, modalOpen: boolean, busy: boolean, injected: boolean }} Snapshot without the app part.
 */
function readPage() {
	const busy = Array.from(document.querySelectorAll('[aria-busy="true"], [role="progressbar"]')).some(function visible(element) {
		return element instanceof HTMLElement && !element.hidden && element.offsetParent !== null;
	});

	return {
		text: document.body ? document.body.innerText : "",
		modalOpen: document.querySelector("dialog[open]:modal") !== null,
		busy,
		injected: window.__exploreInjected === 1,
	};
}

/**
 * Mark the elements an action may target and return how many there are. Runs in the page. Inside an
 * open modal only the modal's elements count, since everything else is inert.
 *
 * @param {"click" | "type"} kind - Which elements to mark.
 * @returns {number} Number of candidates, marked `data-explore-pick="0..n-1"`.
 */
function markCandidates(kind) {
	const scope = document.querySelector("dialog[open]:modal") ?? document;
	const selector =
		kind === "click"
			? 'button, a[href], [role="button"], [role="link"], [role="tab"], [role="menuitem"], input[type="checkbox"], input[type="radio"], summary'
			: 'input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="number"], input[type="tel"], input[type="url"], input[type="password"], textarea, [contenteditable="true"]';
	const candidates = Array.from(scope.querySelectorAll(selector)).filter(function usable(element) {
		return element instanceof HTMLElement && !element.closest("[inert]") && !element.matches(":disabled") && element.offsetParent !== null;
	});

	for (const element of document.querySelectorAll("[data-explore-pick]")) element.removeAttribute("data-explore-pick");
	candidates.forEach(function mark(element, index) {
		element.setAttribute("data-explore-pick", String(index));
	});

	return candidates.length;
}

/**
 * Wait until no busy indicator is visible, up to a budget.
 *
 * @param {import("playwright-core").Page} page - The page.
 * @param {number} budgetMs - Longest wait.
 * @returns {Promise<boolean>} Whether the page settled.
 */
async function settle(page, budgetMs) {
	try {
		await page.waitForFunction(
			function idle() {
				return !Array.from(document.querySelectorAll('[aria-busy="true"], [role="progressbar"]')).some(function visible(element) {
					return element instanceof HTMLElement && !element.hidden && element.offsetParent !== null;
				});
			},
			undefined,
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
	 * @param {string} message - What it reported.
	 */
	constructor(property, message) {
		super(`${property}: ${message}`);
		this.property = property;
		this.detail = message;
	}
}

/**
 * The real system a command runs against: the page, the app extractor and the properties.
 *
 * @typedef {object} Real
 * @property {import("playwright-core").Page} page - The page.
 * @property {(page: import("playwright-core").Page) => Promise<unknown>} extract - App-specific reader.
 * @property {Property[]} properties - Properties to check.
 * @property {string[]} errors - Page errors collected since the last step.
 * @property {number} settleMs - Settle budget per action.
 * @property {number} actionTimeoutMs - Timeout for one Playwright action.
 * @property {string[]} log - Descriptions of the actions taken so far in this run.
 * @property {string[]} typed - Texts typed so far in this run.
 */

/**
 * Take a snapshot of the page.
 *
 * @param {Real} real - The system.
 * @returns {Promise<Snapshot>} Snapshot.
 */
async function snapshot(real) {
	const page = await real.page.evaluate(readPage);

	return { ...page, app: await real.extract(real.page) };
}

/**
 * What the commands may target in the current state. Commands without a target are not applicable,
 * so fast-check never generates them there and drops them when shrinking.
 *
 * @typedef {object} Model
 * @property {number} clickable - Clickable elements on screen.
 * @property {number} typeable - Text fields on screen.
 */

/**
 * Count what the commands may target now.
 *
 * @param {import("playwright-core").Page} page - The page.
 * @returns {Promise<Model>} Targets on screen.
 */
async function targets(page) {
	return { clickable: await page.evaluate(markCandidates, "click"), typeable: await page.evaluate(markCandidates, "type") };
}

/**
 * Run one action, then check every property against the step.
 *
 * @param {Model} model - Targets on screen; updated after the action.
 * @param {Real} real - The system.
 * @param {string} description - Action description.
 * @param {(page: import("playwright-core").Page) => Promise<void>} perform - The action.
 * @returns {Promise<void>} Resolves when every property holds; rejects with a violation otherwise.
 */
async function step(model, real, description, perform) {
	const before = await snapshot(real);

	real.log.push(description);
	real.errors.length = 0;

	try {
		await perform(real.page);
	} catch {
		// An action that cannot apply (the target vanished or became inert) is a no-op, not a finding.
	}

	const settled = await settle(real.page, real.settleMs);
	const after = await snapshot(real);

	Object.assign(model, await targets(real.page));
	const current = { action: description, before, after, errors: [...real.errors], settled, typed: [...real.typed] };

	for (const property of real.properties) {
		const verdict = property.check(current);

		if (verdict !== true) throw new PropertyViolation(property.name, typeof verdict === "string" ? verdict : "does not hold");
	}
}

/**
 * Click the n-th clickable element on screen (modulo how many there are).
 */
class Click {
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
		const count = await real.page.evaluate(markCandidates, "click");
		const target = count === 0 ? null : real.page.locator(`[data-explore-pick="${this.pick % count}"]`);
		const label = target ? await describeTarget(target) : "nothing";

		this.label = `click ${label}`;
		await step(model, real, this.label, async function perform() {
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
class Type {
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
		const count = await real.page.evaluate(markCandidates, "type");
		const target = count === 0 ? null : real.page.locator(`[data-explore-pick="${this.pick % count}"]`);
		const label = target ? await describeTarget(target) : "nothing";
		const text = this.text;

		this.label = `type ${JSON.stringify(text.length > 40 ? `${text.slice(0, 40)}…` : text)} into ${label}`;
		real.typed.push(text);
		await step(model, real, this.label, async function perform() {
			if (target) await target.fill(text, { timeout: real.actionTimeoutMs });
		});
	}

	/** @returns {string} Readable form for reports. */
	toString() {
		return this.label ?? `type ${JSON.stringify(this.text)} into #${this.pick}`;
	}
}

/**
 * Press a key on whatever has focus.
 */
class Press {
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

		await step(model, real, this.toString(), async function perform(page) {
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
class Wait {
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

		await step(model, real, this.toString(), async function perform(page) {
			await page.waitForTimeout(ms);
		});
	}

	/** @returns {string} Readable form for reports. */
	toString() {
		return `wait ${this.ms} ms`;
	}
}

/**
 * Short description of an action target: its accessible name or tag.
 *
 * @param {import("playwright-core").Locator} target - The element.
 * @returns {Promise<string>} Description.
 */
async function describeTarget(target) {
	return target
		.evaluate(function describe(element) {
			const name = element.getAttribute("aria-label") ?? element.labels?.[0]?.textContent ?? element.textContent ?? "";

			return `${element.tagName.toLowerCase()} "${name.trim().replace(/\s+/gu, " ").slice(0, 40)}"`;
		})
		.catch(function unknown() {
			return "an element";
		});
}

/**
 * Default command mix. Weights favor clicks, then typing and keys (Escape most of all); waits keep
 * timers in play.
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
		fc.constantFrom(...(options.waits ?? [100, 700])).map(function wait(ms) {
			return new Wait(ms);
		}),
	];
}

/**
 * Properties that hold for almost any interface.
 *
 * @returns {Property[]} Generic properties.
 */
export function genericProperties() {
	return [
		{
			name: "noUncaughtErrors",
			check: function noUncaughtErrors(step) {
				return step.errors.length === 0 || `uncaught: ${step.errors[0]}`;
			},
		},
		{
			name: "noBrokenValues",
			check: function noBrokenValues(step) {
				const broken = [...step.after.text.matchAll(/\b(?:NaN|undefined|Infinity)\b|\[object Object\]|Invalid Date/gu)].find(function notEcho(match) {
					// The app echoing what the explorer typed (a preview, a search term) is not a broken value.
					return !step.typed.some(function typedIt(text) {
						return text.includes(match[0]);
					});
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
 * @param {number} [options.timeLimitMs] - Search budget (default 2 minutes).
 * @param {number} [options.shrinkMs] - Shrinking budget per finding, on top of the search budget (default 2 minutes).
 * @param {number} [options.settleMs] - Settle budget per action (default 3000).
 * @param {number} [options.seed] - Seed for the first round.
 * @param {boolean} [options.keepGoing] - Continue past the first finding.
 * @param {(finding: Finding) => void} [options.onFinding] - Called as each finding is shrunk.
 * @returns {Promise<{ findings: Finding[], runs: number, ms: number }>} Report.
 */
export async function explore(options) {
	const started = Date.now();
	const deadline = started + (options.timeLimitMs ?? 120_000);
	const findings = [];
	const skipped = new Set();
	let runs = 0;
	let seed = options.seed ?? Date.now() % 2 ** 31;

	while (Date.now() < deadline) {
		const active = options.properties.filter(function notFound(property) {
			return !skipped.has(property.name);
		});

		if (active.length === 0) break;

		const property = fc.asyncProperty(sequences(options), async function sequence(cmds) {
			runs += 1;
			await runSequence(options, active, cmds);
		});
		// Search until the first failure without shrinking, so the time limit bounds only the search.
		const found = await fc.check(property, {
			numRuns: options.numRuns ?? 200,
			seed,
			endOnFailure: true,
			interruptAfterTimeLimit: Math.max(1, deadline - Date.now()),
			markInterruptAsFailure: false,
		});
		// Then shrink from that exact case with its own budget: a failure found late still gets a
		// short reproduction.
		const shrunk = found.failed
			? await fc.check(property, {
					seed: found.seed,
					path: found.counterexamplePath ?? undefined,
					interruptAfterTimeLimit: options.shrinkMs ?? 120_000,
					markInterruptAsFailure: false,
				})
			: found;
		const result = shrunk.failed ? shrunk : found;

		if (!result.failed) {
			// A clean round: keep searching with a fresh seed until the time limit.
			if (result.interrupted) break;
			seed += 1;
			continue;
		}

		const violation = result.errorInstance instanceof PropertyViolation ? result.errorInstance : null;
		const replayPath = /replayPath="([^"]*)"/u.exec(String(result.counterexample?.[0] ?? ""))?.[1] ?? "";
		const location = { seed: result.seed, path: result.counterexamplePath ?? "", replayPath };
		const again = await replay({ ...options, properties: active }, location);
		const finding = {
			property: violation?.property ?? "harness",
			message: violation?.detail ?? String(result.errorInstance ?? result.error),
			actions: again.actions,
			...location,
			reproduced: again.failed && again.property === (violation?.property ?? "harness"),
		};

		findings.push(finding);
		options.onFinding?.(finding);
		if (!options.keepGoing || !violation) break;
		skipped.add(violation.property);
		seed += 1;
	}

	return { findings, runs, ms: Date.now() - started };
}

/**
 * Replay one finding: rerun exactly its shrunk sequence in a fresh context and report what happened.
 *
 * @param {Parameters<typeof explore>[0]} options - The options the finding was found with.
 * @param {{ seed: number, path: string, replayPath: string }} finding - Location from the report.
 * @returns {Promise<{ failed: boolean, property: string | null, message: string, actions: string[] }>} Replay result.
 */
export async function replay(options, finding) {
	let actions = [];
	const result = await fc.check(
		fc.asyncProperty(
			sequences(options, finding.replayPath),
			async function sequence(cmds) {
				const log = [];

				try {
					await runSequence(options, options.properties, cmds, log);
				} finally {
					actions = log;
				}
			},
		),
		{ seed: finding.seed, path: finding.path, endOnFailure: true },
	);
	const violation = result.errorInstance instanceof PropertyViolation ? result.errorInstance : null;

	return {
		failed: result.failed,
		property: result.failed ? (violation?.property ?? "harness") : null,
		message: result.failed ? String(violation?.message ?? result.errorInstance ?? result.error) : "no longer fails",
		actions,
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
 * Run one generated sequence in a fresh browser context.
 *
 * @param {Parameters<typeof explore>[0]} options - Exploration options.
 * @param {Property[]} properties - Properties to check.
 * @param {Iterable<object>} cmds - Generated commands.
 * @param {string[]} [log] - Receives the description of each action taken.
 * @returns {Promise<void>} Resolves when every step held.
 */
async function runSequence(options, properties, cmds, log = []) {
	const context = await options.browser.newContext();
	const page = await context.newPage();
	const real = {
		page,
		extract:
			options.extract ??
			async function none() {
				return null;
			},
		properties,
		errors: [],
		settleMs: options.settleMs ?? 3000,
		actionTimeoutMs: 1000,
		log,
		typed: [],
	};

	page.on("pageerror", function collect(error) {
		real.errors.push(error.message);
	});
	page.on("dialog", function dismiss(dialog) {
		dialog.dismiss().catch(function ignore() {});
	});

	try {
		await page.goto(options.url);

		const model = await targets(page);

		await fc.asyncModelRun(function setup() {
			return { model, real };
		}, cmds);
	} finally {
		await context.close();
	}
}
