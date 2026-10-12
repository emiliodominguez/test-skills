// Screen-reading helpers for extractors. Keep them pure functions of the DOM they are given.

/**
 * Whether an element is rendered and visible to a user.
 *
 * @param element - Element to check.
 * @returns True when visible.
 */
export function isShown(element: Element): boolean {
	return element.isConnected && element.checkVisibility({ opacityProperty: true, visibilityProperty: true });
}

/**
 * Whether an element can be interacted with: shown and not inside an inert subtree.
 *
 * @param element - Element to check.
 * @returns True when usable.
 */
export function isUsable(element: Element): boolean {
	return isShown(element) && element.closest("[inert]") === null;
}

/**
 * Remove lone surrogates, which make a value unreadable to Bombadil and stop the run.
 *
 * @param text - Any text.
 * @param limit - Maximum length kept.
 * @returns Safe text.
 */
export function excerpt(text: string, limit = 120): string {
	return text.replaceAll(/[\uD800-\uDFFF]/gu, "").slice(0, limit);
}

/**
 * An approximate accessible name: aria-label, aria-labelledby, title, associated labels,
 * text content, or an image's alt text.
 *
 * @param element - Element to name.
 * @returns The trimmed name, possibly empty.
 */
export function accessibleName(element: Element): string {
	const document = element.ownerDocument;
	const label = element.getAttribute("aria-label")?.trim();

	if (label) return label;

	const labelledBy = element.getAttribute("aria-labelledby");

	if (labelledBy) {
		const text = labelledBy
			.split(/\s+/u)
			.map(function lookUp(id) {
				return document.getElementById(id)?.textContent?.trim() ?? "";
			})
			.join(" ")
			.trim();

		if (text) return text;
	}

	const title = element.getAttribute("title")?.trim();

	if (title) return title;

	if ("labels" in element) {
		const labels = (element as HTMLInputElement).labels;
		const text = labels
			? Array.from(labels)
					.map(function labelText(node) {
						return node.textContent?.trim() ?? "";
					})
					.join(" ")
					.trim()
			: "";

		if (text) return text;
	}

	const text = element.textContent?.trim();

	if (text) return text;

	const image = element.querySelector("img[alt]");

	return image?.getAttribute("alt")?.trim() ?? "";
}

/**
 * Parse displayed money or count text into signed integer minor units.
 *
 * @param text - Displayed amount in any locale, such as "$1,234.50" or "-12,30 EUR".
 * @returns Signed minor units, or null when the text has no digits.
 */
export function minorUnits(text: string | null | undefined): number | null {
	const digits = (text ?? "").replace(/\D/gu, "");

	if (digits === "") return null;

	return /[-−]/u.test(text ?? "") ? -Number(digits) : Number(digits);
}
