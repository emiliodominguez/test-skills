// Generic, replayable action generators. Combine them with Bombadil's defaults in a top-level
// specification through `weighted([...])`.
import { actions, extract, weighted, type ActionTemplate } from "@antithesishq/bombadil/browser";
import { anyOf, VALUES } from "./values.ts";

/** Key codes Bombadil sends with `PressKey`. */
export const KEYS = { backspace: 8, tab: 9, enter: 13, escape: 27, space: 32, left: 37, up: 38, right: 39, down: 40 } as const;

const focusedField = extract(function readFocus(state) {
	const element = state.document.activeElement;

	if (element instanceof HTMLTextAreaElement) return "textarea";
	if (element instanceof HTMLInputElement) return element.type;
	if (element instanceof HTMLElement && element.isContentEditable) return "contenteditable";

	return null;
});

/** Always available, so the run never stops for lack of an action. */
export const waiting = actions(function idle(): ActionTemplate[] {
	return ["Wait"];
});

/** Keyboard navigation and activation, weighted toward Tab. */
export const keyboard = weighted([
	[10, { PressKey: { code: KEYS.tab } }],
	[4, { PressKey: { code: KEYS.enter } }],
	[3, { PressKey: { code: KEYS.space } }],
	[3, { PressKey: { code: KEYS.escape } }],
	[3, { PressKey: { code: KEYS.down } }],
	[2, { PressKey: { code: KEYS.up } }],
	[1, { PressKey: { code: KEYS.left } }],
	[1, { PressKey: { code: KEYS.right } }],
	[1, { PressKey: { code: KEYS.backspace } }],
]);

/** Short, fast bursts of ordinary text into the focused field; cheaper than the default typing. */
export const shortTyping = actions(function typeShort(): ActionTemplate[] {
	if (focusedField.current === null || focusedField.current === "file") return [];

	return [{ TypeText: { text: { Regexp: VALUES.words }, delayMillis: [0, 5] } }];
});

/** Edge-case and hostile values into the focused text field. Never into password fields. */
export const hostileTyping = actions(function typeHostile(): ActionTemplate[] {
	const field = focusedField.current;

	if (field === null || field === "password" || field === "file") return [];

	const pattern = field === "number" ? VALUES.numbers : anyOf("markup", "unicode", "numbers", "dates", "blank");

	return [{ TypeText: { text: { Regexp: pattern }, delayMillis: [0, 5] } }];
});
