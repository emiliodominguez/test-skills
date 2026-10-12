// Injected markup must stay inert. Bombadil answers dialogs itself, so an `alert(1)` that ran
// would otherwise pass unseen; payloads in values.ts carry the marker id `bmbxss` instead.
import { always } from "@antithesishq/bombadil";
import { extract } from "@antithesishq/bombadil/browser";
import { excerpt } from "./dom.ts";

const injected = extract(function findInjected(state) {
	const markers = Array.from(state.document.querySelectorAll('[id^="bmbxss"], a[href^="javascript:" i]')).map(function describe(element) {
		return excerpt(element.outerHTML, 100);
	});
	const kit = (state.window as unknown as { __bombadil?: { sentinels?: unknown[] } }).__bombadil;
	const sentinels = Array.isArray(kit?.sentinels) ? kit.sentinels.length : 0;

	return { markers, sentinels };
});

/** No typed payload became live markup, and the page kit's sentinels (when present) saw nothing. */
export const injectedTextStaysInert = always(function inert() {
	return injected.current.markers.length === 0 && injected.current.sentinels === 0;
});
