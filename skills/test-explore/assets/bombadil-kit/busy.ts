// Busy indicators must clear: a spinner that never stops is a hang the user cannot escape.
import { extract } from "@antithesishq/bombadil/browser";
import { isShown } from "./dom.ts";
import { endsWithin } from "./temporal.ts";

const busyCount = extract(function countBusy(state) {
	const busy = state.document.querySelectorAll('[aria-busy="true"], [role="progressbar"]:not([aria-valuenow]), [data-busy="true"]');

	return Array.from(busy).filter(isShown).length;
});

/** Every busy indicator clears within ten seconds. */
export const busyIndicatorsSettle = endsWithin(function busy() {
	return busyCount.current > 0;
}, 10);
