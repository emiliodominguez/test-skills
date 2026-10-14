#!/usr/bin/env node
// Browser-level checks of the fast-check exploration kit (skills/test-explore/assets/fast-check-explore.mjs):
// what it can target, what counts as busy or modal, and what it reports on small pages that each
// break one thing. Prints one line per check; exits 0 only when every check holds.
//
//   CHROME=/path/to/chromium node examples/explore-kit/verify.mjs

import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { findChromium } from "../../skills/test-explore/assets/bombadil-run.mjs";
import {
	BUSY,
	CLICKABLE,
	MODAL,
	TYPEABLE,
	explore,
	genericProperties,
	markCandidates,
	readPage,
} from "../../skills/test-explore/assets/fast-check-explore.mjs";

/** Pages served by the check server, by path. */
const PAGES = {
	"/targets": `<!doctype html><body>
		<button id="plain">plain</button>
		<button id="fixed" style="position:fixed;top:0;right:0">fixed</button>
		<button id="hidden" style="visibility:hidden">hidden</button>
		<button id="transparent" style="opacity:0">transparent</button>
		<button id="disabled" disabled>disabled</button>
		<input id="submit" type="submit" value="send">
		<div id="checkbox" role="checkbox" aria-checked="false" tabindex="0">box</div>
		<a id="local" href="/other">local</a>
		<a id="external" href="https://example.com/">external</a>
		<select id="select"><option>a</option><option>b</option></select>
		<div id="editable" contenteditable>edit</div>
		<input id="text" type="text">
		<div role="progressbar" aria-valuenow="40" aria-valuemin="0" aria-valuemax="100">40%</div>
	</body>`,
	"/modal": `<!doctype html><body>
		<button id="behind">behind</button>
		<div role="dialog" aria-modal="true" aria-label="Confirm"><button id="inside">inside</button></div>
	</body>`,
	"/spinner": `<!doctype html><body><div aria-busy="true" style="position:fixed;inset:0">Loading</div></body>`,
	"/load-error": `<!doctype html><body><script>throw new Error("load boom")</script><button>ok</button></body>`,
	"/two-clicks": `<!doctype html><body>
		<button id="a">A</button><button id="b">B</button><p id="out">0</p>
		<script>
			let armed = false;
			document.getElementById("a").addEventListener("click", function arm() { armed = true; });
			document.getElementById("b").addEventListener("click", function fire() {
				document.getElementById("out").textContent = armed ? String(Number("x")) : "1";
			});
		</script>
	</body>`,
	"/aria-escape": `<!doctype html><body>
		<button id="open">Open</button>
		<div id="dlg" role="dialog" aria-modal="true" aria-label="Settings" hidden><button>Save</button></div>
		<script>
			document.getElementById("open").addEventListener("click", function open() { document.getElementById("dlg").hidden = false; });
		</script>
	</body>`,
	"/console": `<!doctype html><body><button id="c">C</button>
		<script>document.getElementById("c").addEventListener("click", function log() { console.error("state got lost"); });</script>
	</body>`,
	"/server-error": `<!doctype html><body><button id="s">S</button>
		<script>document.getElementById("s").addEventListener("click", function call() { fetch("/api/fail"); });</script>
	</body>`,
	"/external-only": `<!doctype html><body><p>Nothing to do here.</p><a href="https://example.com/">Elsewhere</a></body>`,
	"/clean": `<!doctype html><body><button id="ok">OK</button><p>Fine</p></body>`,
};

/**
 * Serve the check pages on an ephemeral port.
 *
 * @returns {Promise<{ origin: string, close: () => Promise<void> }>} Origin and a stopper.
 */
async function serve() {
	const server = createServer(function respond(request, response) {
		const path = new URL(request.url ?? "/", "http://localhost").pathname;

		if (path === "/api/fail") {
			response.writeHead(500, { "content-type": "text/plain" }).end("boom");
			return;
		}

		const page = PAGES[path] ?? (path === "/other" ? "<!doctype html><body><p>Other</p></body>" : null);

		if (page === null) {
			response.writeHead(204).end();
			return;
		}

		response.writeHead(200, { "content-type": "text/html" }).end(page);
	});

	await new Promise(function listen(done) {
		server.listen(0, "127.0.0.1", done);
	});

	const address = /** @type {import("node:net").AddressInfo} */ (server.address());

	return {
		origin: `http://127.0.0.1:${address.port}`,
		close: function close() {
			return new Promise(function stop(done) {
				server.close(function closed() {
					done();
				});
			});
		},
	};
}

/**
 * Ids of the elements the kit marks for one selector on a page.
 *
 * @param {import("playwright-core").Page} page - The page.
 * @param {string} selector - Candidate selector.
 * @returns {Promise<string[]>} Marked ids, in mark order.
 */
async function marked(page, selector) {
	await page.evaluate(markCandidates, { selector, modal: MODAL });

	return page.evaluate(function ids() {
		return Array.from(document.querySelectorAll("[data-explore-pick]")).map(function id(element) {
			return element.id;
		});
	});
}

/**
 * Explore one check page briefly and return the report.
 *
 * @param {import("playwright-core").Browser} browser - Browser.
 * @param {string} url - Page.
 * @param {Partial<Parameters<typeof explore>[0]>} [overrides] - Option overrides.
 * @returns {Promise<Awaited<ReturnType<typeof explore>>>} Report.
 */
function short(browser, url, overrides = {}) {
	return explore({ browser, url, properties: genericProperties(), timeLimitMs: 15_000, shrinkMs: 30_000, settleMs: 1500, seed: 7, ...overrides });
}

/**
 * Entry point.
 *
 * @returns {Promise<number>} Exit code.
 */
async function main() {
	const results = [];

	/**
	 * Record one check.
	 *
	 * @param {string} name - What is checked.
	 * @param {boolean} ok - Whether it held.
	 * @param {string} detail - Evidence.
	 */
	function claim(name, ok, detail) {
		results.push(ok);
		console.log(`${ok ? "ok  " : "FAIL"}  ${name} (${detail})`);
	}

	const site = await serve();
	const executablePath = process.env.CHROME || (existsSync(chromium.executablePath()) ? undefined : findChromium(process.env));
	const browser = await chromium.launch({ executablePath, headless: true });

	try {
		const page = await browser.newPage();

		await page.goto(`${site.origin}/targets`);

		const clicks = await marked(page, CLICKABLE);
		const types = await marked(page, TYPEABLE);
		const selects = await marked(page, "select");
		const expectedClicks = ["plain", "fixed", "submit", "checkbox", "local"];

		claim(
			"click targets include fixed, submit, ARIA and same-origin controls; exclude hidden, transparent, disabled and off-origin ones",
			JSON.stringify(clicks) === JSON.stringify(expectedClicks),
			clicks.join(", "),
		);
		claim(
			"type targets include text inputs and contenteditable",
			JSON.stringify(types) === JSON.stringify(["editable", "text"]),
			types.join(", "),
		);
		claim("select boxes are targets", JSON.stringify(selects) === JSON.stringify(["select"]), selects.join(", "));

		const determinate = await page.evaluate(readPage, { modal: MODAL, busy: BUSY });

		claim("a determinate progress bar is not busy", determinate.busy === false, `busy=${determinate.busy}`);

		await page.goto(`${site.origin}/modal`);

		const modalClicks = await marked(page, CLICKABLE);
		const modalState = await page.evaluate(readPage, { modal: MODAL, busy: BUSY });

		claim(
			"an ARIA modal counts as a modal and scopes the targets",
			modalState.modalOpen && JSON.stringify(modalClicks) === JSON.stringify(["inside"]),
			`modalOpen=${modalState.modalOpen}, targets ${modalClicks.join(", ")}`,
		);

		await page.goto(`${site.origin}/spinner`);

		const spinner = await page.evaluate(readPage, { modal: MODAL, busy: BUSY });

		claim("a fixed-position aria-busy overlay counts as busy", spinner.busy === true, `busy=${spinner.busy}`);
		await page.close();

		const load = await short(browser, `${site.origin}/load-error`);

		claim(
			"an error thrown while the page loads is reported, with no actions",
			load.findings[0]?.property === "noUncaughtErrors" && load.findings[0].actions.length === 0 && /load boom/u.test(load.findings[0].message),
			`${load.findings[0]?.property}: ${load.findings[0]?.message}`,
		);

		const twoClicks = await short(browser, `${site.origin}/two-clicks`, { timeLimitMs: 30_000 });
		const nan = twoClicks.findings[0];

		claim(
			"a two-step bug is shrunk to the two clicks and reproduces on replay",
			nan?.property === "noBrokenValues" &&
				nan.reproduced &&
				JSON.stringify(nan.actions) === JSON.stringify(['click button "A"', 'click button "B"']),
			nan ? `${nan.actions.join(" > ")}; reproduced=${nan.reproduced}` : "no finding",
		);

		const escape = await short(browser, `${site.origin}/aria-escape`, { timeLimitMs: 30_000 });

		claim(
			"Escape that cannot close an ARIA modal is reported",
			escape.findings[0]?.property === "escapeClosesDialogs",
			escape.findings.map(function name(finding) {
				return `${finding.property}: ${finding.actions.join(" > ")}`;
			})[0] ?? "no finding",
		);

		const consoleRun = await short(browser, `${site.origin}/console`);

		claim("a console error is reported", consoleRun.findings[0]?.property === "noConsoleErrors", consoleRun.findings[0]?.message ?? "no finding");

		const failed = await short(browser, `${site.origin}/server-error`);

		claim("a 5xx response is reported", failed.findings[0]?.property === "noFailedRequests", failed.findings[0]?.message ?? "no finding");

		const external = await short(browser, `${site.origin}/external-only`, { timeLimitMs: 8000 });

		claim(
			"an off-origin link is never followed, so the run stays clean",
			external.findings.length === 0 && external.runs > 0,
			`${external.findings.length} findings in ${external.runs} sequences`,
		);

		const throwing = await short(browser, `${site.origin}/clean`, {
			timeLimitMs: 8000,
			properties: [
				{
					name: "readsMissingApp",
					check: function readsMissingApp(step) {
						return /** @type {{ total: number }} */ (step.after.app).total === 0;
					},
				},
			],
		});

		claim(
			"a property that throws is reported as that property, not as a harness failure",
			throwing.findings[0]?.property === "readsMissingApp" && /check threw/u.test(throwing.findings[0].message),
			throwing.findings[0]?.message ?? "no finding",
		);

		const unreachable = await short(browser, "http://127.0.0.1:9/", { timeLimitMs: 8000 });

		claim(
			"an unreachable app is a harness failure, not a property finding",
			unreachable.findings[0]?.property === "harness",
			unreachable.findings[0]?.message.slice(0, 60) ?? "no finding",
		);

		let rejected = "";

		try {
			await short(browser, `${site.origin}/clean`, { timeLimitMs: Number("2m") });
		} catch (error) {
			rejected = error instanceof Error ? error.message : String(error);
		}

		claim(
			"a time limit that is not a number is rejected instead of reporting a clean run",
			/timeLimitMs must be/u.test(rejected),
			rejected || "accepted",
		);

		const clean = await short(browser, `${site.origin}/clean`, { timeLimitMs: 8000 });

		claim(
			"a correct page stays silent",
			clean.findings.length === 0 && clean.runs > 0,
			`${clean.findings.length} findings in ${clean.runs} sequences`,
		);
	} finally {
		await browser.close();
		await site.close();
	}

	const passed = results.filter(Boolean).length;

	console.log(`\n${passed}/${results.length} kit checks hold.`);

	return passed === results.length ? 0 : 1;
}

main().then(
	function finish(code) {
		process.exitCode = code;
	},
	function crash(error) {
		console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
		process.exitCode = 1;
	},
);
