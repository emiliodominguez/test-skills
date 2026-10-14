// Modal behavior: Escape dismisses, focus stays inside.
import { always, next } from "@antithesishq/bombadil";
import { extract } from "@antithesishq/bombadil/browser";
import { isShown } from "./dom.ts";

/** Key code Bombadil sends for Escape. */
const ESCAPE = 27;

const modal = extract(function readModal(state) {
	const open = Array.from(state.document.querySelectorAll("dialog:modal, [role=dialog][aria-modal=true], [role=alertdialog][aria-modal=true]")).filter(isShown);
	const top = open.at(-1) ?? null;
	const active = state.document.activeElement;

	return {
		count: open.length,
		// A dialog that must not close on Escape opts out with data-escape="ignore".
		closable: top !== null && top.getAttribute("data-escape") !== "ignore",
		focusInside: top === null || active === null || active === state.document.body || top.contains(active),
	};
});

const escapePressed = extract(function readLastAction(state) {
	const action = state.lastAction;

	return typeof action === "object" && action !== null && "PressKey" in action && action.PressKey.code === ESCAPE;
});

/** Pressing Escape with a closable modal open closes it. */
export const escapeClosesDialogs = always(function whenOpen() {
	const before = modal.current;

	if (before.count === 0 || !before.closable) return true;

	return next(function afterward() {
		return !escapePressed.current || modal.current.count < before.count;
	});
});

/** While a modal is open, focus is inside it. */
export const focusStaysInModal = always(function trapped() {
	return modal.current.focusInside;
});
