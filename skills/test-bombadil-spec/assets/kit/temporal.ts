// Temporal shapes used across the kit. Import with an explicit `.ts` extension: Bombadil's loader
// follows only explicit extensions.
import { always, eventually, now, type Formula } from "@antithesishq/bombadil";

/**
 * A check that may fail briefly (while data refetches or a view re-renders) but must hold again
 * within a bound.
 *
 * @param check - Condition over current extractor values.
 * @param seconds - How long the check may stay false.
 * @returns The property.
 */
export function settles(check: () => boolean, seconds = 5): Formula {
	return always(
		now(function broken() {
			return !check();
		}).implies(eventually(check).within(seconds, "seconds")),
	);
}

/**
 * Something that starts must end within a bound: `started` implies `ended` within the bound.
 *
 * @param started - True while the thing is in progress.
 * @param seconds - Maximum duration.
 * @returns The property.
 */
export function endsWithin(started: () => boolean, seconds: number): Formula {
	return always(
		now(started).implies(
			eventually(function ended() {
				return !started();
			}).within(seconds, "seconds"),
		),
	);
}
