// A small repository over a SQL database, with three bugs that a test against a mocked database
// client passes and a test against the real engine catches: a transfer that is not atomic, an
// email lookup that depends on the column's collation, and an ordering that depends on where the
// engine sorts NULL. Every function takes a `node:sqlite` `DatabaseSync` (or anything with the
// same `exec` and `prepare` surface) and an `options.fixed` switch that turns the bug off.

/** Schema for the examples. The CHECK constraint is what the real engine enforces and a mock does not. */
export const SCHEMA = `
	CREATE TABLE accounts (
		id TEXT PRIMARY KEY,
		owner_email TEXT NOT NULL UNIQUE,
		balance_cents INTEGER NOT NULL CHECK (balance_cents >= 0)
	);
	CREATE TABLE tasks (
		id INTEGER PRIMARY KEY,
		title TEXT NOT NULL,
		due_on TEXT
	);
`;

/** A refused transfer, with a machine-readable reason. */
export class TransferError extends Error {
	/**
	 * @param {"insufficient-funds" | "unknown-account" | "invalid-amount"} reason - Why the transfer was refused.
	 * @param {string} message - Human-readable explanation.
	 */
	constructor(reason, message) {
		super(message);
		this.name = "TransferError";
		this.reason = reason;
	}
}

/**
 * Create the schema and insert seed rows.
 *
 * @param {{ exec(sql: string): void, prepare(sql: string): { run(...params: unknown[]): unknown } }} db - An open database.
 * @param {{ accounts?: Array<[string, string, number]>, tasks?: Array<[string, string | null]> }} [seed] - Rows to insert.
 * @returns {void}
 */
export function createSchema(db, seed = {}) {
	db.exec(SCHEMA);

	const insertAccount = db.prepare("INSERT INTO accounts (id, owner_email, balance_cents) VALUES (?, ?, ?)");
	const insertTask = db.prepare("INSERT INTO tasks (title, due_on) VALUES (?, ?)");

	for (const [id, email, balance] of seed.accounts ?? []) insertAccount.run(id, email, balance);
	for (const [title, dueOn] of seed.tasks ?? []) insertTask.run(title, dueOn);
}

/**
 * Move money between two accounts.
 *
 * The buggy version credits first and debits second as two independent statements: when the debit
 * violates the balance CHECK, the credit has already been written, and an unknown target account
 * is credited zero rows without complaint. The fixed version runs both inside a savepoint (which
 * also nests inside a caller's or a test's transaction), checks that each statement changed
 * exactly one row, and rolls back on any failure.
 *
 * @param {{ exec(sql: string): void, prepare(sql: string): { run(...params: unknown[]): { changes: number | bigint } } }} db - An open database.
 * @param {{ from: string, to: string, amountCents: number }} transfer - Source, target and positive integer amount.
 * @param {{ fixed?: boolean }} [options] - `fixed` turns the bug off.
 * @returns {void}
 * @throws {TransferError} When the fixed version refuses the transfer.
 */
export function transfer(db, { from, to, amountCents }, options = {}) {
	const credit = db.prepare("UPDATE accounts SET balance_cents = balance_cents + ? WHERE id = ?");
	const debit = db.prepare("UPDATE accounts SET balance_cents = balance_cents - ? WHERE id = ?");

	if (!options.fixed) {
		credit.run(amountCents, to);
		debit.run(amountCents, from);

		return;
	}

	if (!Number.isInteger(amountCents) || amountCents <= 0) {
		throw new TransferError("invalid-amount", `amount must be a positive integer, got ${amountCents}`);
	}

	db.exec("SAVEPOINT transfer");

	try {
		if (Number(credit.run(amountCents, to).changes) !== 1) throw new TransferError("unknown-account", `no account ${to}`);

		try {
			if (Number(debit.run(amountCents, from).changes) !== 1) throw new TransferError("unknown-account", `no account ${from}`);
		} catch (error) {
			if (isCheckViolation(error)) throw new TransferError("insufficient-funds", `account ${from} cannot cover ${amountCents}`);

			throw error;
		}

		db.exec("RELEASE transfer");
	} catch (error) {
		db.exec("ROLLBACK TO transfer");
		db.exec("RELEASE transfer");

		throw error;
	}
}

/**
 * Whether an error raised by the driver is a CHECK constraint violation.
 *
 * @param {unknown} error - A thrown value.
 * @returns {boolean} True for SQLite's SQLITE_CONSTRAINT_CHECK (extended code 275).
 */
function isCheckViolation(error) {
	return typeof error === "object" && error !== null && "errcode" in error && error.errcode === 275;
}

/**
 * Find an account by its owner's email address, as a person would type it at sign-in.
 *
 * The buggy version compares with `=`, which uses the column's collation: binary in SQLite, and
 * case-sensitive in PostgreSQL unless the column is `citext` or uses a nondeterministic collation, so `ana@example.com` misses `Ana@Example.com`.
 *
 * @param {{ prepare(sql: string): { get(...params: unknown[]): unknown } }} db - An open database.
 * @param {string} email - Address as typed.
 * @param {{ fixed?: boolean }} [options] - `fixed` turns the bug off.
 * @returns {{ id: string, owner_email: string, balance_cents: number } | undefined} The account, if any.
 */
export function findAccountByEmail(db, email, options = {}) {
	const sql = options.fixed
		? "SELECT id, owner_email, balance_cents FROM accounts WHERE owner_email = ? COLLATE NOCASE"
		: "SELECT id, owner_email, balance_cents FROM accounts WHERE owner_email = ?";

	return /** @type {{ id: string, owner_email: string, balance_cents: number } | undefined} */ (db.prepare(sql).get(email.trim()));
}

/**
 * Tasks for an agenda: soonest due date first, tasks without a due date last.
 *
 * The buggy version relies on the engine's default NULL placement, which differs by engine:
 * SQLite and MySQL sort NULL first in ascending order, PostgreSQL sorts it last.
 *
 * @param {{ prepare(sql: string): { all(...params: unknown[]): unknown[] } }} db - An open database.
 * @param {{ fixed?: boolean }} [options] - `fixed` turns the bug off.
 * @returns {Array<{ title: string, due_on: string | null }>} Tasks in agenda order.
 */
export function listAgenda(db, options = {}) {
	const sql = options.fixed
		? "SELECT title, due_on FROM tasks ORDER BY due_on IS NULL, due_on, id"
		: "SELECT title, due_on FROM tasks ORDER BY due_on, id";

	return /** @type {Array<{ title: string, due_on: string | null }>} */ (db.prepare(sql).all());
}
