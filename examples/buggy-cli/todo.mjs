#!/usr/bin/env node
// A tiny full-screen todo list for the terminal, with seeded bugs. TODO_FIXED=1 turns them off.
//
// Commands: add <text>, done <n>, undo <n>, clear, quit.
import { createInterface } from "node:readline";

const fixed = process.env.TODO_FIXED === "1";
/** The list holds at most this many items, so it always fits on the screen. */
const MAX_ITEMS = 20;
/** @type {Array<{ text: string, done: boolean }>} */
const items = [];
let open = 0;
let message = "type: add <text>, done <n>, undo <n>, clear";

/**
 * Shorten a title to fit its column.
 *
 * @param {string} text - Typed title.
 * @returns {string} Title of at most 24 bytes (seeded) or 24 characters (fixed).
 */
function shorten(text) {
	// Bug "byte-cut": cutting UTF-8 bytes can split a character and print U+FFFD.
	if (!fixed) return Buffer.from(text).subarray(0, 24).toString("utf8");

	return Array.from(text).slice(0, 24).join("");
}

/**
 * Redraw the whole screen.
 */
function render() {
	const lines = [`todo | open: ${open} | total: ${items.length}`, ""];

	items.forEach(function line(item, index) {
		lines.push(`${String(index + 1).padStart(2)}. [${item.done ? "x" : " "}] ${item.text}`);
	});

	lines.push("", message);
	process.stdout.write(`\x1b[2J\x1b[H${lines.join("\r\n")}\r\n> `);
}

/**
 * Item at a typed 1-based position.
 *
 * @param {string} typed - Position as typed.
 * @returns {{ text: string, done: boolean } | undefined} The item.
 */
function itemAt(typed) {
	const index = Number(typed) - 1;

	return Number.isInteger(index) && index >= 0 ? items[index] : undefined;
}

/**
 * Run one command.
 *
 * @param {string} line - Typed line.
 */
function run(line) {
	const [command, ...rest] = line.trim().split(/\s+/u);
	const argument = rest.join(" ");

	if (command === "add" && argument && items.length >= MAX_ITEMS) {
		message = "list is full; clear done items first";
	} else if (command === "add" && argument) {
		items.push({ text: shorten(argument), done: false });
		open += 1;
		message = "added";
	} else if (command === "done" || command === "undo") {
		const item = itemAt(argument);

		if (!fixed && command === "done" && argument === "0") {
			// Bug "zero-crash": position 0 reads before the list and crashes the program.
			items[-1].done = true;
		} else if (!fixed && command === "done" && item) {
			// Bug "double-done": marking a finished item done again lowers the count again.
			item.done = true;
			open -= 1;
		} else if (!item) {
			message = `no item ${argument}`;
		} else if (command === "done" && !item.done) {
			item.done = true;
			open -= 1;
		} else if (command === "undo" && item.done) {
			item.done = false;
			open += 1;
		}
	} else if (command === "clear") {
		for (let index = items.length - 1; index >= 0; index -= 1) if (items[index].done) items.splice(index, 1);
		message = "cleared";
	} else if (command === "quit") {
		process.exit(0);
	} else if (command) {
		message = `unknown command: ${command}`;
	}

	render();
}

const input = createInterface({ input: process.stdin, output: process.stdout, terminal: true });

input.on("line", run);
input.on("close", function closed() {
	process.exit(0);
});
render();
