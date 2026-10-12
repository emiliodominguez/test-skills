// Text sanity: values a user should never read on screen.
import { always } from "@antithesishq/bombadil";
import { extract } from "@antithesishq/bombadil/browser";
import { excerpt } from "./dom.ts";

/** Rendered values that betray a bug in formatting or data flow. */
const BROKEN = /\bNaN\b|\bundefined\b|\bInfinity\b|\[object Object\]|Invalid Date/u;

const brokenTexts = extract(function findBroken(state) {
	const found: string[] = [];
	const body = state.document.body;

	if (!body) return found;

	const walker = state.document.createTreeWalker(body, NodeFilter.SHOW_TEXT);

	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const text = node.textContent?.trim() ?? "";
		const parent = node.parentElement;

		if (text === "" || !parent || !parent.checkVisibility()) continue;

		if (BROKEN.test(text)) found.push(excerpt(text));
	}

	const fields = state.document.querySelectorAll("input:not([type=hidden]), output");

	for (const field of Array.from(fields)) {
		const value = (field as HTMLInputElement).value ?? field.textContent ?? "";

		if (BROKEN.test(value) && field.checkVisibility()) found.push(excerpt(value));
	}

	return found;
});

/** No visible text reads NaN, undefined, Infinity, [object Object] or Invalid Date. */
export const noBrokenValues = always(function clean() {
	return brokenTexts.current.length === 0;
});
