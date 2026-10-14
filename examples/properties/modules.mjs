// Small modules with one realistic bug each, and their fixed versions, for the property-based
// testing examples in `test/properties-examples.test.ts`. Each bug is the kind example tests miss
// and one property shape catches: allocation (invariant), CSV (round trip), LRU cache
// (model-based), discount (metamorphic), sorting (oracle).

/**
 * Split an amount in cents into `parts` shares that differ by at most one cent.
 *
 * @param {number} cents - Non-negative integer amount.
 * @param {number} parts - Positive integer number of shares.
 * @param {{ fixed?: boolean }} [options] - `fixed` turns the bug off.
 * @returns {number[]} The shares.
 */
export function allocate(cents, parts, options = {}) {
	if (!options.fixed) {
		// Bug: rounding each share loses or invents cents (100 / 3 -> 33 + 33 + 33).
		return Array.from({ length: parts }, function share() {
			return Math.round(cents / parts);
		});
	}

	const base = Math.floor(cents / parts);
	const remainder = cents - base * parts;

	return Array.from({ length: parts }, function share(_, index) {
		return base + (index < remainder ? 1 : 0);
	});
}

/**
 * Encode rows of fields as CSV.
 *
 * @param {string[][]} rows - Rows of fields.
 * @param {{ fixed?: boolean }} [options] - `fixed` turns the bug off.
 * @returns {string} CSV text.
 */
export function encodeCsv(rows, options = {}) {
	return rows
		.map(function encodeRow(row) {
			return row
				.map(function encodeField(field) {
					// Bug: quotes fields with commas but does not double embedded quotes.
					if (!options.fixed) return /[",\n]/u.test(field) ? `"${field}"` : field;

					return /[",\n\r]/u.test(field) ? `"${field.replaceAll('"', '""')}"` : field;
				})
				.join(",");
		})
		.join("\n");
}

/**
 * Decode CSV text produced by `encodeCsv`.
 *
 * @param {string} text - CSV text.
 * @returns {string[][]} Rows of fields.
 */
export function decodeCsv(text) {
	const rows = [];
	let row = [];
	let field = "";
	let quoted = false;

	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];

		if (quoted) {
			if (char === '"' && text[index + 1] === '"') {
				field += '"';
				index += 1;
			} else if (char === '"') {
				quoted = false;
			} else {
				field += char;
			}
		} else if (char === '"') {
			quoted = true;
		} else if (char === ",") {
			row.push(field);
			field = "";
		} else if (char === "\n") {
			row.push(field);
			rows.push(row);
			row = [];
			field = "";
		} else {
			field += char;
		}
	}

	row.push(field);
	rows.push(row);

	return rows;
}

/**
 * A least-recently-used cache.
 *
 * @param {number} capacity - Maximum number of entries.
 * @param {{ fixed?: boolean }} [options] - `fixed` turns the bug off.
 * @returns {{ get: (key: string) => number | undefined, set: (key: string, value: number) => void, size: () => number }} The cache.
 */
export function createLru(capacity, options = {}) {
	const entries = new Map();

	return {
		get: function get(key) {
			if (!entries.has(key)) return undefined;

			const value = entries.get(key);

			// Bug: a read does not refresh recency, so a hot key is evicted as if it were cold.
			if (options.fixed) {
				entries.delete(key);
				entries.set(key, value);
			}

			return value;
		},
		set: function set(key, value) {
			entries.delete(key);
			entries.set(key, value);
			if (entries.size > capacity) entries.delete(entries.keys().next().value);
		},
		size: function size() {
			return entries.size;
		},
	};
}

/**
 * Total in cents after a tiered discount: 10% off the part of the subtotal from 10,000 to 50,000
 * cents, 20% off the part above 50,000.
 *
 * @param {number[]} lines - Line amounts in cents.
 * @param {{ fixed?: boolean }} [options] - `fixed` turns the bug off.
 * @returns {number} Total in cents.
 */
export function discountedTotal(lines, options = {}) {
	const subtotal = lines.reduce(function add(acc, line) {
		return acc + line;
	}, 0);

	if (!options.fixed) {
		// Bug: the tier rate applies to the whole subtotal, so crossing a threshold lowers the total
		// (a customer pays less after adding an item).
		const rate = subtotal >= 50_000 ? 0.2 : subtotal >= 10_000 ? 0.1 : 0;

		return Math.round(subtotal * (1 - rate));
	}

	const discount = 0.1 * Math.max(0, Math.min(subtotal, 50_000) - 10_000) + 0.2 * Math.max(0, subtotal - 50_000);

	return Math.round(subtotal - discount);
}

/**
 * Sort numbers ascending with an insertion sort tuned for nearly sorted input.
 *
 * @param {number[]} values - Numbers.
 * @param {{ fixed?: boolean }} [options] - `fixed` turns the bug off.
 * @returns {number[]} A sorted copy.
 */
export function fastSort(values, options = {}) {
	const result = [...values];

	for (let index = 1; index < result.length; index += 1) {
		const value = result[index];
		let position = index - 1;

		// Bug: stops one slot early, so a new minimum never reaches index 0.
		while (position >= (options.fixed ? 0 : 1) && result[position] > value) {
			result[position + 1] = result[position];
			position -= 1;
		}

		result[position + 1] = value;
	}

	return result;
}
