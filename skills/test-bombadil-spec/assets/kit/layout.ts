// Layout and accessibility invariants that hold for almost any web app.
import { always } from "@antithesishq/bombadil";
import { extract } from "@antithesishq/bombadil/browser";
import { accessibleName, excerpt, isShown } from "./dom.ts";

const layout = extract(function readLayout(state) {
	const document = state.document;
	const view = state.window;
	const root = document.documentElement;
	const unnamed: string[] = [];
	const ids = new Map<string, number>();
	const dangling: string[] = [];
	const brokenImages: string[] = [];
	const offscreenDialogs: string[] = [];

	for (const control of Array.from(document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=link]"))) {
		if (isShown(control) && accessibleName(control) === "") unnamed.push(excerpt(control.outerHTML, 80));
	}

	for (const element of Array.from(document.querySelectorAll("[id]"))) ids.set(element.id, (ids.get(element.id) ?? 0) + 1);

	for (const element of Array.from(document.querySelectorAll("[aria-labelledby], [aria-describedby], [aria-controls], label[for]"))) {
		const references = [element.getAttribute("aria-labelledby"), element.getAttribute("aria-describedby"), element.getAttribute("for")];

		if (element.getAttribute("aria-expanded") !== "false") references.push(element.getAttribute("aria-controls"));

		for (const id of references.join(" ").split(/\s+/u)) {
			if (id && id !== "null" && document.getElementById(id) === null) dangling.push(id);
		}
	}

	for (const image of Array.from(document.images)) {
		if (image.complete && image.naturalWidth === 0 && isShown(image)) brokenImages.push(excerpt(image.currentSrc || image.src, 80));
	}

	for (const dialog of Array.from(document.querySelectorAll("dialog[open], [role=dialog], [role=alertdialog]"))) {
		if (!isShown(dialog)) continue;

		const rect = dialog.getBoundingClientRect();

		if (rect.left < -1 || rect.top < -1 || rect.right > view.innerWidth + 1 || rect.bottom > view.innerHeight + 1) {
			offscreenDialogs.push(excerpt(accessibleName(dialog) || dialog.tagName, 60));
		}
	}

	return {
		overflow: root.scrollWidth - view.innerWidth,
		unnamed,
		duplicateIds: [...ids].filter(function repeated(entry) {
			return entry[1] > 1;
		}).map(function idOf(entry) {
			return entry[0];
		}),
		dangling,
		brokenImages,
		offscreenDialogs,
	};
});

/** The page never scrolls sideways. */
export const noHorizontalOverflow = always(function fits() {
	return layout.current.overflow <= 1;
});

/** Every visible control has an accessible name. */
export const controlsHaveNames = always(function named() {
	return layout.current.unnamed.length === 0;
});

/** Ids are unique. */
export const noDuplicateIds = always(function unique() {
	return layout.current.duplicateIds.length === 0;
});

/** ARIA and label references point at elements that exist. */
export const referencesResolve = always(function resolved() {
	return layout.current.dangling.length === 0;
});

/** Visible images load. */
export const imagesLoad = always(function loaded() {
	return layout.current.brokenImages.length === 0;
});

/** Open dialogs fit inside the viewport. */
export const dialogsFitTheWindow = always(function inside() {
	return layout.current.offscreenDialogs.length === 0;
});
