// Value sets for typing, as regular expressions in Bombadil's (Rust) regex dialect, so replays
// regenerate the same text. Extend them with domain sets: valid values and near misses.

/** Edge-case values grouped by what they probe. */
export const VALUES = {
	/** Dates that are invalid, ambiguous or at boundaries. */
	dates: "(29/02/2024|29/02/2025|31/04/2026|30/02/2026|00/01/2026|2026-13-01|2026-10-08|10/08/2026|[0-9]{8}|[0-9]{2}/[0-9]{2})",
	/** Numbers with signs, separators, exponents and magnitudes that break naive parsing. */
	numbers: "(0|-0|-1|0[.,]00|0[.,]001|-0[.,]01|1e9|1E-3|9007199254740993|99999999999999999999|1\\.234\\.567,89|1,234,567\\.89|00001|[.,]5|5[.,]| 42 |4 2|\\+7|--3)",
	/** Scripts, combining marks, zero-width and bidi characters, emoji. */
	unicode: "(ÁÉÍÓÚ ñü|العربية|עברית|日本語|\u{1F600}\u{1F44D}\u{1F3FD}|e\\x{0301}|a\\x{200B}b|\\x{202E}txet|\\x{00A0}nbsp\\x{00A0})",
	/** Markup, template and injection payloads. Executable ones carry the marker id `bmbxss`. */
	markup: "(<b>bold</b>|%s %d|' OR 1=1 --|\\{\\{7\\*7\\}\\}|\\$\\{7\\*7\\}|<img id=bmbxss src=x onerror=alert\\(1\\)>|\"><svg id=bmbxss onload=alert\\(1\\)>|<a id=bmbxss href=javascript:alert\\(1\\)>x</a>|<iframe id=bmbxss srcdoc=x></iframe>)",
	/** Whitespace-only and blank-looking input. */
	blank: "( |  |\\t|\\x{3000})",
	/** Short ordinary text. */
	words: "[A-Za-z][a-z]{1,10}( [a-z]{1,10}){0,3}",
} as const;

/**
 * Join value sets into one alternation.
 *
 * @param names - Value set names.
 * @returns A regular expression matching any value of the chosen sets.
 */
export function anyOf(...names: Array<keyof typeof VALUES>): string {
	return `(${names
		.map(function pattern(name) {
			return VALUES[name];
		})
		.join("|")})`;
}
