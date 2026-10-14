#!/usr/bin/env node
// Explore the demo shop with fast-check and Playwright instead of Bombadil: the same seeded bugs,
// found by random action sequences and shrunk to short reproductions.
//
//   node examples/buggy-shop/fast-check/explore.mjs            # with bugs: exits 2 with findings
//   node examples/buggy-shop/fast-check/explore.mjs --fixed    # bugs off: exits 0
//   node examples/buggy-shop/fast-check/explore.mjs --time-limit 60 --seed 42
//
// Exit codes match the Bombadil runner: 0 clean, 2 a property was violated, 1 harness error.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { locateChrome } from "../../../skills/test-explore/assets/bombadil-run.mjs";
import { explore, genericProperties } from "../../../skills/test-explore/assets/fast-check-explore.mjs";

const SERVER = fileURLToPath(new URL("../serve.mjs", import.meta.url));

/**
 * Parse arguments.
 *
 * @param {string[]} argv - Arguments after the script path.
 * @returns {{ fixed: boolean, timeLimitMs: number, seed: number | undefined, port: number }} Options.
 */
export function parseArgs(argv) {
	/**
	 * Value of an option, or its fallback.
	 *
	 * @param {string} name - Option name.
	 * @param {string | undefined} fallback - Default value.
	 * @returns {string | undefined} Value.
	 */
	function value(name, fallback) {
		const index = argv.indexOf(name);

		return index === -1 ? fallback : argv[index + 1];
	}

	const seed = value("--seed", undefined);

	return {
		fixed: argv.includes("--fixed"),
		timeLimitMs: Number(value("--time-limit", "120")) * 1000,
		seed: seed === undefined ? undefined : Number(seed),
		port: Number(value("--port", "8766")),
	};
}

/**
 * Domain property: without a coupon, the total equals the sum of the displayed lines.
 *
 * @type {import("../../../skills/test-explore/assets/fast-check-explore.mjs").Property}
 */
export const cartTotalAddsUp = {
	name: "cartTotalAddsUp",
	check: function cartTotalAddsUp(step) {
		const cart = /** @type {{ lines: (number | null)[], total: number | null, discounted: boolean }} */ (step.after.app);

		if (
			cart.discounted ||
			cart.total === null ||
			cart.lines.some(function unreadable(line) {
				return line === null;
			})
		) {
			return true;
		}

		const sum = cart.lines.reduce(function add(acc, line) {
			return acc + (line ?? 0);
		}, 0);

		return cart.total === sum || `total ${cart.total} != sum of lines ${sum}`;
	},
};

/**
 * Read the cart in the page: line amounts and total in cents, and whether a coupon applies.
 *
 * @param {import("playwright-core").Page} page - The page.
 * @returns {Promise<{ lines: (number | null)[], total: number | null, discounted: boolean }>} Cart.
 */
export async function readCart(page) {
	return page.evaluate(function read() {
		/**
		 * Parse "$12.50" into 1250, or null when it is not a plain amount.
		 *
		 * @param {string | null | undefined} text - Displayed amount.
		 * @returns {number | null} Cents.
		 */
		function cents(text) {
			const match = /^\$(\d+)\.(\d{2})$/u.exec((text ?? "").trim());

			return match ? Number(match[1]) * 100 + Number(match[2]) : null;
		}

		return {
			lines: Array.from(document.querySelectorAll("#cart tbody tr")).map(function line(row) {
				return cents(row.children[2]?.textContent);
			}),
			total: cents(document.getElementById("total")?.textContent),
			discounted: /Coupon applied/u.test(document.getElementById("coupon-message")?.textContent ?? ""),
		};
	});
}

/**
 * Start the demo server and wait until it answers.
 *
 * @param {boolean} fixed - Serve the fixed build.
 * @param {number} port - Port.
 * @returns {Promise<import("node:child_process").ChildProcess>} The server process.
 */
async function startServer(fixed, port) {
	const server = spawn(process.execPath, [SERVER, ...(fixed ? ["--fixed"] : [])], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });

	for (let attempt = 0; attempt < 100; attempt += 1) {
		try {
			if ((await fetch(`http://127.0.0.1:${port}/`)).ok) return server;
		} catch {
			// Not listening yet.
		}

		await new Promise(function pause(done) {
			setTimeout(done, 100);
		});
	}

	server.kill();
	throw new Error(`the demo server did not answer on port ${port}`);
}

/**
 * Entry point.
 *
 * @param {string[]} argv - Arguments after the script path.
 * @returns {Promise<number>} Exit code.
 */
async function main(argv) {
	const options = parseArgs(argv);
	const server = await startServer(options.fixed, options.port);
	const executablePath = locateChrome(process.env) ?? undefined;
	const browser = await chromium.launch({ executablePath, headless: true });

	try {
		const report = await explore({
			browser,
			url: `http://127.0.0.1:${options.port}/`,
			properties: [...genericProperties(), cartTotalAddsUp],
			extract: readCart,
			timeLimitMs: options.timeLimitMs,
			seed: options.seed,
			keepGoing: true,
			onFinding: function print(finding) {
				console.log(`\n✗ ${finding.property}: ${finding.message}${finding.reproduced ? "" : " (did not reproduce on replay)"}`);
				for (const [index, action] of finding.actions.entries()) console.log(`  ${index + 1}. ${action}`);
				console.log(`  replay: seed ${finding.seed}, path "${finding.path}", replayPath "${finding.replayPath}"`);
			},
		});

		console.log(
			`\n${report.findings.length} finding(s) in ${report.runs} sequences, ${Math.round(report.ms / 1000)} s (${options.fixed ? "fixed build" : "with bugs"}).`,
		);

		return report.findings.length > 0 ? 2 : 0;
	} finally {
		await browser.close();
		server.kill();
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main(process.argv.slice(2)).then(
		function finish(code) {
			process.exitCode = code;
		},
		function crash(error) {
			console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
			process.exitCode = 1;
		},
	);
}
