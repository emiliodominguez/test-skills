// Specification for the demo todo CLI: Bombadil's terminal defaults plus one domain property.
// Run it with `pnpm demo:cli`.
import { always } from "@antithesishq/bombadil";
import { actions, extract, weighted, type ActionTemplate } from "@antithesishq/bombadil/terminal";

export * from "@antithesishq/bombadil/terminal/defaults/properties";

const screen = extract(function readScreen(state) {
	const rows: string[] = [];

	for (let index = 0; index < state.grid.size.rows; index += 1) rows.push(state.grid.rowText(index));

	const header = /open: (-?\d+) \| total: (\d+)/u.exec(rows[0] ?? "");
	const items = rows.filter(function isItem(row) {
		return /^\s*\d+\. \[[ x]\]/u.test(row);
	});

	return {
		open: header ? Number(header[1]) : null,
		total: header ? Number(header[2]) : null,
		unchecked: items.filter(function isOpen(row) {
			return row.includes("[ ]");
		}).length,
		listed: items.length,
	};
});

/** The header's open count equals the unchecked rows, and the total equals the rows shown. */
export const headerMatchesList = always(function matches() {
	const { open, total, unchecked, listed } = screen.current;

	return open === null || total === null || listed < total || (open === unchecked && total === listed);
});

/** Typed commands, with positions just past the list to probe bounds. */
export const commands = weighted([
	[
		300,
		actions(function add(): ActionTemplate[] {
			return [
				{ TypeText: { Regexp: "add (milk|tea|café crème brûlée au lait|x日本語のテキストです|😀 party with friends 🎉🎉|[a-z]{1,12})\r" } },
			];
		}),
	],
	[
		240,
		actions(function done(): ActionTemplate[] {
			return [{ TypeText: { Regexp: "done [1-9]\r" } }];
		}),
	],
	// Position zero is a boundary worth probing, but rarely: a crash ends the run.
	[
		1,
		actions(function doneZero(): ActionTemplate[] {
			return [{ TypeText: { Regexp: "done 0\r" } }];
		}),
	],
	[
		90,
		actions(function undo(): ActionTemplate[] {
			return [{ TypeText: { Regexp: "undo [0-9]\r" } }];
		}),
	],
	[
		60,
		actions(function clear(): ActionTemplate[] {
			return [{ TypeText: { Regexp: "clear\r" } }];
		}),
	],
]);
