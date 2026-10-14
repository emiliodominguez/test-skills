// A cart row with an icon-only remove button, used as evidence by `test/component-examples.test.ts`.
//
// The shipped bug: the button holds only a decorative icon, so it has no accessible name. axe-core
// reports it in jsdom, and a query by role and name cannot find it.
import { createElement as h, type ReactElement } from "react";

/**
 * A cart line with a remove control.
 *
 * @param props - Product name, removal callback and variant switch.
 * @returns The list item.
 */
export function CartItem(props: { name: string; onRemove(): void; fixed?: boolean }): ReactElement {
	const icon = h("svg", { "aria-hidden": "true", width: 16, height: 16, viewBox: "0 0 16 16" }, h("path", { d: "M3 3l10 10M13 3L3 13" }));
	const label = props.fixed ? `Remove ${props.name}` : undefined;

	return h(
		"li",
		{ className: "cart-item" },
		h("span", null, props.name),
		h("button", { type: "button", "aria-label": label, onClick: props.onRemove }, icon),
	);
}

/**
 * Text that fails WCAG contrast (light gray on white), to show what jsdom cannot measure.
 *
 * @returns A paragraph with inline low-contrast colors.
 */
export function FaintNotice(): ReactElement {
	return h("p", { style: { color: "#d4d4d4", backgroundColor: "#ffffff" } }, "Free shipping over $50");
}
