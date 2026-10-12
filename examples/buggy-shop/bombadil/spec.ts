// Specification for the demo shop: the generic kit plus two domain properties.
// Run it with `node examples/buggy-shop/demo.mjs`.
import { always } from "@antithesishq/bombadil";
import { extract, weighted } from "@antithesishq/bombadil/browser";
import { clicks, inputs, reload, scroll } from "@antithesishq/bombadil/browser/defaults/actions";
import { hostileTyping, keyboard, shortTyping, waiting } from "../../../skills/test-bombadil-spec/assets/kit/actions.ts";
import { minorUnits } from "../../../skills/test-bombadil-spec/assets/kit/dom.ts";
import { settles } from "../../../skills/test-bombadil-spec/assets/kit/temporal.ts";

export * from "../../../skills/test-bombadil-spec/assets/kit/properties.ts";

const cart = extract(function readCart(state) {
	const rows = Array.from(state.document.querySelectorAll("#cart tbody tr"));
	const lines = rows.map(function lineAmount(row) {
		return minorUnits(row.children[2]?.textContent);
	});
	const total = minorUnits(state.document.getElementById("total")?.textContent);
	const discounted = /Coupon applied/u.test(state.document.getElementById("coupon-message")?.textContent ?? "");

	return { lines, total, discounted };
});

/** Without a coupon, the total equals the sum of the displayed lines. */
export const cartTotalAddsUp = settles(function addsUp() {
	const { lines, total, discounted } = cart.current;

	if (
		discounted ||
		total === null ||
		lines.some(function unreadable(line) {
			return line === null;
		})
	) {
		return true;
	}

	return (
		total ===
		lines.reduce(function sum(acc: number, line) {
			return acc + (line ?? 0);
		}, 0)
	);
}, 2);

/** An empty cart shows a zero total. */
export const emptyCartIsFree = always(function free() {
	return cart.current.total === null || cart.current.lines.length > 0 || cart.current.total === 0;
});

export const shopping = weighted([
	[100, clicks],
	[30, inputs],
	[60, hostileTyping],
	[20, shortTyping],
	[25, keyboard],
	[10, scroll],
	// A rare reload escapes dead states such as a stuck modal; reloads do not replay, so keep it rare.
	[3, reload],
	[1, waiting],
]);
