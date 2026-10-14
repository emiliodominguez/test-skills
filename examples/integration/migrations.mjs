// Versioned migrations and a runner, with two bugs that a migration test on an empty database
// passes and a test on seeded, production-like data catches: a money conversion that truncates
// instead of rounding, and a runner that applies a multi-statement migration outside a
// transaction, so a failure halfway leaves the schema changed but the version unchanged.

/**
 * @typedef {{ exec(sql: string): void, prepare(sql: string): { get(...params: unknown[]): unknown } }} Database
 * @typedef {{ version: number, name: string, up: string, down: string }} Migration
 */

/**
 * The migrations, in order. Version 1 stores amounts as floating-point currency units; version 2
 * converts them to integer cents; version 3 adds a settled flag and makes `order_id` unique.
 *
 * @param {{ fixed?: boolean }} [options] - `fixed` makes version 2 round instead of truncate.
 * @returns {Migration[]} Migrations sorted by version.
 */
export function paymentMigrations(options = {}) {
	// Bug: CAST truncates toward zero, and 19.99 * 100 is 1998.9999999999998 in binary floating point.
	const toCents = options.fixed ? "CAST(ROUND(amount * 100) AS INTEGER)" : "CAST(amount * 100 AS INTEGER)";

	return [
		{
			version: 1,
			name: "create payments",
			up: "CREATE TABLE payments (id INTEGER PRIMARY KEY, order_id TEXT NOT NULL, amount REAL NOT NULL);",
			down: "DROP TABLE payments;",
		},
		{
			version: 2,
			name: "amounts to integer cents",
			up: `
				ALTER TABLE payments ADD COLUMN amount_cents INTEGER NOT NULL DEFAULT 0;
				UPDATE payments SET amount_cents = ${toCents};
				ALTER TABLE payments DROP COLUMN amount;
			`,
			down: `
				ALTER TABLE payments ADD COLUMN amount REAL NOT NULL DEFAULT 0;
				UPDATE payments SET amount = amount_cents / 100.0;
				ALTER TABLE payments DROP COLUMN amount_cents;
			`,
		},
		{
			version: 3,
			name: "settled flag and one payment per order",
			up: `
				ALTER TABLE payments ADD COLUMN settled INTEGER NOT NULL DEFAULT 0;
				CREATE UNIQUE INDEX payments_order_id ON payments (order_id);
			`,
			down: `
				DROP INDEX payments_order_id;
				ALTER TABLE payments DROP COLUMN settled;
			`,
		},
	];
}

/**
 * The schema version recorded in the database.
 *
 * @param {Database} db - An open database.
 * @returns {number} The current version; 0 for an empty database.
 */
export function schemaVersion(db) {
	const row = /** @type {{ user_version: number }} */ (db.prepare("PRAGMA user_version").get());

	return row.user_version;
}

/**
 * Migrate up or down to a target version, one migration at a time.
 *
 * The buggy runner executes each migration's statements directly and records the version after
 * they all succeed: a failure in the second statement leaves the first applied, and the next run
 * repeats it. The fixed runner wraps each step, including the version bump, in one transaction.
 *
 * @param {Database} db - An open database.
 * @param {Migration[]} migrations - Migrations sorted by version.
 * @param {number} target - Version to reach.
 * @param {{ fixed?: boolean }} [options] - `fixed` makes each step atomic.
 * @returns {void}
 * @throws {Error} The engine's error from the failing step; earlier steps stay applied.
 */
export function migrate(db, migrations, target, options = {}) {
	let current = schemaVersion(db);

	while (current !== target) {
		const goingUp = target > current;
		const step = migrations.find(function isNext(migration) {
			return migration.version === (goingUp ? current + 1 : current);
		});

		if (!step) throw new Error(`no migration from version ${current} toward ${target}`);

		const next = goingUp ? step.version : step.version - 1;
		const sql = `${goingUp ? step.up : step.down}\nPRAGMA user_version = ${next};`;

		if (options.fixed) {
			db.exec("BEGIN");

			try {
				db.exec(sql);
				db.exec("COMMIT");
			} catch (error) {
				db.exec("ROLLBACK");

				throw error;
			}
		} else {
			db.exec(sql);
		}

		current = next;
	}
}

/**
 * Whether a table has a column, read from the live schema rather than from the migration files.
 *
 * @param {{ prepare(sql: string): { all(...params: unknown[]): unknown[] } }} db - An open database.
 * @param {string} table - Table name.
 * @param {string} column - Column name.
 * @returns {boolean} True when the column exists.
 */
export function hasColumn(db, table, column) {
	const columns = /** @type {Array<{ name: string }>} */ (db.prepare("SELECT name FROM pragma_table_info(?)").all(table));

	return columns.some(function named(entry) {
		return entry.name === column;
	});
}
