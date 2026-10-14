// Evidence for `test-integration`: each example module has a bug that lives at a boundary. A test
// against a mock, a stub or an empty database passes on it; a test against the real engine, the
// running provider, production-like data or an injected fault catches it, and passes on the fix.
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";
import fc from "fast-check";
import { delay, HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { createSchema, findAccountByEmail, listAgenda, transfer, TransferError } from "../examples/integration/accounts.mjs";
import { hasColumn, migrate, paymentMigrations, schemaVersion } from "../examples/integration/migrations.mjs";
import {
	amountDue,
	breakingResponseChanges,
	ConsumerNotFound,
	ConsumerOrder,
	createOrdersProvider,
	fetchOrder,
	providerOrderSchema,
} from "../examples/integration/orders.mjs";
import { createPaymentClient, PaymentError } from "../examples/integration/payments.mjs";

type Options = { fixed?: boolean };

const BUGGY: Options = {};
const FIXED: Options = { fixed: true };

/**
 * A fresh in-memory database with the accounts schema and seed rows: one per test, so no test
 * sees another's writes.
 *
 * @returns The open database.
 */
function seededDatabase(): DatabaseSync {
	const db = new DatabaseSync(":memory:");

	createSchema(db, {
		accounts: [
			["a-1", "Ana@Example.com", 5_000],
			["a-2", "bo@example.com", 1_000],
		],
		tasks: [
			["file taxes", "2026-11-01"],
			["someday", null],
			["renew passport", "2026-10-20"],
		],
	});

	return db;
}

/**
 * Balances by account id.
 *
 * @param db - An open database.
 * @returns Account id to balance in cents.
 */
function balances(db: DatabaseSync): Record<string, number> {
	const rows = db.prepare("SELECT id, balance_cents FROM accounts ORDER BY id").all() as Array<{ id: string; balance_cents: number }>;

	return Object.fromEntries(
		rows.map(function toEntry(row) {
			return [row.id, row.balance_cents];
		}),
	);
}

/**
 * Sum of every balance: a transfer must never change it.
 *
 * @param db - An open database.
 * @returns Total cents across accounts.
 */
function totalCents(db: DatabaseSync): number {
	return Object.values(balances(db)).reduce(function add(sum, balance) {
		return sum + balance;
	}, 0);
}

/**
 * Run a function and capture what it threw.
 *
 * @param run - Code expected to throw.
 * @returns The thrown value, or undefined when it returned.
 */
function thrownBy(run: { (): unknown }): unknown {
	try {
		run();
	} catch (error) {
		return error;
	}

	return undefined;
}

describe("database: the mocked client passes, the real engine catches the bug", function databaseSuite() {
	test("mock-based tests pass on all three bugs", function mocked() {
		const run = vi.fn().mockReturnValue({ changes: 1 });
		const get = vi.fn().mockReturnValue({ id: "a-1", owner_email: "Ana@Example.com", balance_cents: 5_000 });
		const all = vi.fn().mockReturnValue([
			{ title: "renew passport", due_on: "2026-10-20" },
			{ title: "someday", due_on: null },
		]);
		const db = { exec: vi.fn(), prepare: vi.fn().mockReturnValue({ run, get, all }) };

		transfer(db, { from: "a-2", to: "a-1", amountCents: 5_000 }, BUGGY);
		expect(run).toHaveBeenCalledWith(5_000, "a-1");
		expect(run).toHaveBeenCalledWith(5_000, "a-2");
		expect(findAccountByEmail(db, "ana@example.com", BUGGY)?.id).toBe("a-1");
		expect(listAgenda(db, BUGGY).at(-1)?.title).toBe("someday");
	});

	test("an overdraft: the CHECK constraint fires after the credit was written, creating money", function overdraft() {
		const buggy = seededDatabase();
		const fixed = seededDatabase();
		const request = { from: "a-2", to: "a-1", amountCents: 5_000 };

		expect(String(thrownBy(transfer.bind(null, buggy, request, BUGGY)))).toContain("CHECK constraint failed");
		expect(totalCents(buggy)).toBe(11_000);

		const refusal = thrownBy(transfer.bind(null, fixed, request, FIXED));

		expect(refusal).toBeInstanceOf(TransferError);
		expect((refusal as TransferError).reason).toBe("insufficient-funds");
		expect(balances(fixed)).toEqual({ "a-1": 5_000, "a-2": 1_000 });
	});

	test("an unknown target: zero rows updated is not an error to the engine, so money vanishes", function unknownTarget() {
		const buggy = seededDatabase();
		const fixed = seededDatabase();
		const request = { from: "a-1", to: "a-9", amountCents: 700 };

		transfer(buggy, request, BUGGY);
		expect(totalCents(buggy)).toBe(5_300);
		expect((thrownBy(transfer.bind(null, fixed, request, FIXED)) as TransferError).reason).toBe("unknown-account");
		expect(totalCents(fixed)).toBe(6_000);
	});

	test("equality follows the column collation, so a differently cased email misses", function collation() {
		const db = seededDatabase();

		expect(findAccountByEmail(db, "ana@example.com", BUGGY)).toBeUndefined();
		expect(findAccountByEmail(db, " ana@example.com ", FIXED)?.id).toBe("a-1");
	});

	test("SQLite sorts NULL first in ascending order, so undated tasks lead the agenda", function nullOrdering() {
		const db = seededDatabase();

		/**
		 * Titles of the agenda in order.
		 *
		 * @param options - Variant.
		 * @returns Task titles.
		 */
		function titles(options: Options): string[] {
			return listAgenda(db, options).map(function toTitle(task) {
				return task.title;
			});
		}

		expect(titles(BUGGY)).toEqual(["someday", "renew passport", "file taxes"]);
		expect(titles(FIXED)).toEqual(["renew passport", "file taxes", "someday"]);
	});
});

describe("isolation: a transaction per test conflicts with code that opens its own", function isolationSuite() {
	test("a nested BEGIN fails inside the test's transaction; a savepoint nests and rolls back with it", function perTestTransaction() {
		const db = seededDatabase();

		db.exec("BEGIN");
		expect(String(thrownBy(db.exec.bind(db, "BEGIN")))).toContain("cannot start a transaction within a transaction");

		transfer(db, { from: "a-1", to: "a-2", amountCents: 2_000 }, FIXED);
		expect(balances(db)).toEqual({ "a-1": 3_000, "a-2": 3_000 });

		db.exec("ROLLBACK");
		expect(balances(db)).toEqual({ "a-1": 5_000, "a-2": 1_000 });
	});
});

describe("migrations: an empty database passes, production-like data catches the bug", function migrationSuite() {
	const AMOUNTS = [19.99, 0.29, 1.15, 4.35, 10, 0.5];

	/**
	 * A database at schema version 1 holding payments with the given amounts.
	 *
	 * @param amounts - Amounts in currency units, as version 1 stored them.
	 * @param orderIds - Order id per amount; defaults to one order per payment.
	 * @returns The open database.
	 */
	function versionOne(amounts: number[], orderIds?: string[]): DatabaseSync {
		const db = new DatabaseSync(":memory:");

		migrate(db, paymentMigrations(FIXED), 1, FIXED);

		const insert = db.prepare("INSERT INTO payments (order_id, amount) VALUES (?, ?)");

		amounts.forEach(function insertPayment(amount, index) {
			insert.run(orderIds?.[index] ?? `o-${index}`, amount);
		});

		return db;
	}

	/**
	 * Converted amounts after migrating to version 2.
	 *
	 * @param db - A database at version 2.
	 * @returns `amount_cents` by insertion order.
	 */
	function cents(db: DatabaseSync): number[] {
		return (db.prepare("SELECT amount_cents FROM payments ORDER BY id").all() as Array<{ amount_cents: number }>).map(function toCents(row) {
			return row.amount_cents;
		});
	}

	test.each([
		["buggy", BUGGY],
		["fixed", FIXED],
	])("the %s migrations go up and down on an empty database", function emptyDatabase(_label, options) {
		const db = new DatabaseSync(":memory:");

		migrate(db, paymentMigrations(options), 3, options);
		expect([schemaVersion(db), hasColumn(db, "payments", "amount_cents"), hasColumn(db, "payments", "amount")]).toEqual([3, true, false]);

		migrate(db, paymentMigrations(options), 0, options);
		expect(schemaVersion(db)).toBe(0);
	});

	test("up on seeded amounts: truncation loses a cent on four of six rows; rounding keeps them", function seeded() {
		const buggy = versionOne(AMOUNTS);
		const fixed = versionOne(AMOUNTS);

		migrate(buggy, paymentMigrations(BUGGY), 2, BUGGY);
		migrate(fixed, paymentMigrations(FIXED), 2, FIXED);

		expect(cents(buggy)).toEqual([1_998, 28, 114, 434, 1_000, 50]);
		expect(cents(fixed)).toEqual([1_999, 29, 115, 435, 1_000, 50]);
	});

	test("a property over generated amounts: up keeps every cent and down restores every amount", function roundTrip() {
		/**
		 * The migration round trip as a property.
		 *
		 * @param options - Variant.
		 * @returns The property.
		 */
		function property(options: Options) {
			return fc.property(fc.array(fc.integer({ min: 0, max: 10_000_000 }), { minLength: 1, maxLength: 20 }), function keepsEveryCent(values) {
				const db = versionOne(
					values.map(function toUnits(value) {
						return value / 100;
					}),
				);

				migrate(db, paymentMigrations(options), 2, options);
				expect(cents(db)).toEqual(values);
				migrate(db, paymentMigrations(options), 1, options);
				expect(
					(db.prepare("SELECT amount FROM payments ORDER BY id").all() as Array<{ amount: number }>).map(function toAmount(row) {
						return row.amount;
					}),
				).toEqual(
					values.map(function toUnits(value) {
						return value / 100;
					}),
				);
			});
		}

		const buggy = fc.check(property(BUGGY), { seed: 42, numRuns: 200 });

		fc.assert(property(FIXED), { seed: 42, numRuns: 200 });
		expect(buggy.failed).toBe(true);
		// The failing set is sparse (0.29, 0.57 and 0.58 fail; 0.30 passes), so shrinking stalls on a
		// large value; what matters is that the reported value truncates in binary floating point.
		const [failing] = buggy.counterexample as [number[]];

		expect(
			failing.some(function truncates(value) {
				return Math.trunc((value / 100) * 100) !== value;
			}),
		).toBe(true);
	});

	test("a step that fails halfway: the buggy runner leaves a half-applied schema; the atomic one rolls back", function halfway() {
		const orders = ["o-1", "o-2", "o-2"];
		const buggy = versionOne([5, 2.5, 2.5], orders);
		const fixed = versionOne([5, 2.5, 2.5], orders);

		migrate(buggy, paymentMigrations(FIXED), 2, FIXED);
		migrate(fixed, paymentMigrations(FIXED), 2, FIXED);

		expect(String(thrownBy(migrate.bind(null, buggy, paymentMigrations(FIXED), 3, BUGGY)))).toContain("UNIQUE constraint failed");
		expect([schemaVersion(buggy), hasColumn(buggy, "payments", "settled")]).toEqual([2, true]);
		expect(String(thrownBy(migrate.bind(null, buggy, paymentMigrations(FIXED), 3, BUGGY)))).toContain("duplicate column name: settled");

		expect(String(thrownBy(migrate.bind(null, fixed, paymentMigrations(FIXED), 3, FIXED)))).toContain("UNIQUE constraint failed");
		expect([schemaVersion(fixed), hasColumn(fixed, "payments", "settled")]).toEqual([2, false]);

		fixed.exec("DELETE FROM payments WHERE id = 3");
		migrate(fixed, paymentMigrations(FIXED), 3, FIXED);
		expect(schemaVersion(fixed)).toBe(3);
	});
});

describe("contract: consumer expectations verified against the running provider", function contractSuite() {
	/**
	 * Start a provider version on an ephemeral local port.
	 *
	 * @param version - Provider version.
	 * @returns Its origin and a function that stops it.
	 */
	async function startProvider(version: 1 | 2 | 3): Promise<{ baseUrl: string; stop: { (): Promise<void> } }> {
		const server = createServer(createOrdersProvider({ version }));

		server.listen(0, "127.0.0.1");
		await once(server, "listening");

		const { port } = server.address() as AddressInfo;

		return {
			baseUrl: `http://127.0.0.1:${port}`,
			/**
			 * Close the server and wait until it has stopped.
			 *
			 * @returns Resolves once closed.
			 */
			stop: async function stop() {
				server.close();
				await once(server, "close");
			},
		};
	}

	/** The consumer's interactions: a request, the status it expects and the body shape it relies on. */
	const INTERACTIONS = [
		{ path: "/orders/o-1", status: 200, schema: ConsumerOrder },
		{ path: "/orders/o-404", status: 404, schema: ConsumerNotFound },
	];

	/**
	 * Replay every consumer interaction against a provider and collect each mismatch.
	 *
	 * @param version - Provider version to verify.
	 * @returns One line per mismatch; empty when the provider honors the contract.
	 */
	async function verify(version: 1 | 2 | 3): Promise<string[]> {
		const provider = await startProvider(version);
		const problems: string[] = [];

		try {
			for (const interaction of INTERACTIONS) {
				const response = await fetch(`${provider.baseUrl}${interaction.path}`);
				const parsed = interaction.schema.safeParse(await response.json());

				if (response.status !== interaction.status) problems.push(`${interaction.path}: status ${response.status}`);

				for (const issue of parsed.error?.issues ?? []) problems.push(`${interaction.path}: ${issue.path.join(".")} ${issue.code}`);
			}
		} finally {
			await provider.stop();
		}

		return problems;
	}

	test("the consumer's stubbed test passes, and against provider 3 the buggy consumer silently computes a string", async function silentDrift() {
		const stub = { id: "o-1", status: "paid", total_cents: 1_999, currency: "EUR", customer: { id: "c-7", email: "ana@example.com" } };

		expect(amountDue(ConsumerOrder.parse(stub), 500)).toBe(2_499);

		const provider = await startProvider(3);

		try {
			expect(amountDue(await fetchOrder(provider.baseUrl, "o-1", BUGGY), 500)).toBe("1999500");
			await expect(fetchOrder(provider.baseUrl, "o-1", FIXED)).rejects.toBeInstanceOf(z.ZodError);
		} finally {
			await provider.stop();
		}
	});

	test("verification passes provider 1 and 2 (an added field) and names the drifted field in 3", async function verification() {
		expect(await verify(1)).toEqual([]);
		expect(await verify(2)).toEqual([]);
		expect(await verify(3)).toEqual(["/orders/o-1: total_cents invalid_type"]);
	});

	test("a diff of the published schemas flags the breaking change before anything runs", function schemaDiff() {
		/**
		 * The published JSON Schema of a provider version.
		 *
		 * @param version - Provider version.
		 * @returns The JSON Schema.
		 */
		function published(version: 1 | 2 | 3): Record<string, unknown> {
			return z.toJSONSchema(providerOrderSchema(version)) as Record<string, unknown>;
		}

		expect(breakingResponseChanges(published(1), published(2))).toEqual([]);
		expect(breakingResponseChanges(published(2), published(3))).toEqual(['$.total_cents: type "integer" -> "string"']);
		expect(breakingResponseChanges(published(2), published(1))).toEqual(["$.placed_at: removed"]);

		const widened = z.toJSONSchema(providerOrderSchema(2).extend({ status: z.enum(["open", "paid", "refunded", "disputed"]) })) as Record<
			string,
			unknown
		>;

		expect(breakingResponseChanges(published(2), widened)).toEqual(['$.status: new enum value "disputed"']);
	});
});

describe("faults at the payment boundary, injected with msw", function faultSuite() {
	const PROVIDER = "https://payments.example.test";
	const STALL_MS = 1_000;
	const server = setupServer();

	type Fault = "lose-response" | "stall" | "unavailable" | "reject" | "malformed" | "none";

	/**
	 * Install a fake provider that honors idempotency keys like the real one, and fails each
	 * attempt as scripted.
	 *
	 * @param faults - Fault for each attempt in order; attempts past the end succeed.
	 * @returns The charges the provider recorded and the number of attempts it received.
	 */
	function fakeProvider(faults: Fault[]): { ledger: Array<{ id: string; key: string | null }>; state: { attempts: number } } {
		const ledger: Array<{ id: string; key: string | null }> = [];
		const byKey = new Map<string, { id: string; amount_cents: number }>();
		const state = { attempts: 0 };

		server.use(
			http.post(`${PROVIDER}/charges`, async function charges({ request }) {
				const fault = faults[state.attempts] ?? "none";

				state.attempts += 1;

				if (fault === "unavailable") return HttpResponse.json({ error: "unavailable" }, { status: 503 });
				if (fault === "reject") return HttpResponse.json({ error: "card_declined" }, { status: 422 });

				const body = (await request.json()) as { amount_cents: number };
				const key = request.headers.get("idempotency-key");
				let record = key ? byKey.get(key) : undefined;

				if (!record) {
					record = { id: `ch_${ledger.length + 1}`, amount_cents: body.amount_cents };
					ledger.push({ id: record.id, key });
					if (key) byKey.set(key, record);
				}

				// The charge is committed before each of these faults, as when a response is lost or slow.
				if (fault === "lose-response") return HttpResponse.error();
				if (fault === "stall") await delay(STALL_MS);
				if (fault === "malformed") return HttpResponse.json({ status: "ok" });

				return HttpResponse.json(record, { status: 201 });
			}),
		);

		return { ledger, state };
	}

	/**
	 * A client for the fake provider.
	 *
	 * @param options - Variant.
	 * @returns The client.
	 */
	function client(options: Options) {
		return createPaymentClient({ baseUrl: PROVIDER, timeoutMs: 100, maxAttempts: 3, backoffMs: 10, fixed: options.fixed });
	}

	const ORDER = { orderId: "o-1", amountCents: 2_499 };

	beforeAll(function listen() {
		server.listen({ onUnhandledFrame: "error" });
	});

	afterEach(function reset() {
		server.resetHandlers();
	});

	afterAll(function close() {
		server.close();
	});

	test("an unhandled request fails instead of reaching the network", async function unhandled() {
		// msw 3 names this option `onUnhandledFrame`; the msw 2 name `onUnhandledRequest` is ignored at
		// runtime, so the request goes to the network instead (asserted in the last suite).
		const error = await fetch(`${PROVIDER}/refunds`, { method: "POST" }).catch(function caught(reason: unknown) {
			return reason;
		});

		expect(String((error as Error).cause)).toContain('"error" strategy');
	});

	test("a response lost after the charge: the retry charges twice without a key, once with one", async function lostResponse() {
		const buggy = fakeProvider(["lose-response"]);

		await client(BUGGY).charge(ORDER);
		expect(buggy.ledger).toHaveLength(2);

		server.resetHandlers();

		const fixed = fakeProvider(["lose-response"]);

		await expect(client(FIXED).charge(ORDER)).resolves.toMatchObject({ id: "ch_1" });
		expect([fixed.ledger.length, fixed.state.attempts]).toEqual([1, 2]);
	});

	test("a stalled provider: no timeout waits out the stall; a timeout and keyed retry finish early with one charge", async function stall() {
		fakeProvider(["stall"]);

		let started = performance.now();

		await client(BUGGY).charge(ORDER);
		expect(performance.now() - started).toBeGreaterThanOrEqual(STALL_MS - 50);

		server.resetHandlers();

		const fixed = fakeProvider(["stall"]);

		started = performance.now();
		await client(FIXED).charge(ORDER);
		expect(performance.now() - started).toBeLessThan(STALL_MS / 2);
		expect([fixed.ledger.length, fixed.state.attempts]).toEqual([1, 2]);
	});

	test("a refusal: the buggy client retries a 422 to the budget; the fixed one stops at once", async function refusal() {
		const buggy = fakeProvider(["reject", "reject", "reject"]);

		await expect(client(BUGGY).charge(ORDER)).rejects.toThrow();
		expect(buggy.state.attempts).toBe(3);

		server.resetHandlers();

		const fixed = fakeProvider(["reject", "reject", "reject"]);

		await expect(client(FIXED).charge(ORDER)).rejects.toMatchObject({ reason: "rejected" });
		expect(fixed.state.attempts).toBe(1);
	});

	test("a malformed success: the buggy client returns a charge without an id; the fixed one refuses it", async function malformed() {
		fakeProvider(["malformed"]);
		expect(await client(BUGGY).charge(ORDER)).toEqual({ status: "ok" });

		server.resetHandlers();
		fakeProvider(["malformed"]);
		await expect(client(FIXED).charge(ORDER)).rejects.toBeInstanceOf(PaymentError);
	});

	test("transient 503s: the fixed client retries within its budget, then gives up with a typed error", async function unavailable() {
		const recovers = fakeProvider(["unavailable", "unavailable"]);

		await expect(client(FIXED).charge(ORDER)).resolves.toMatchObject({ id: "ch_1" });
		expect([recovers.ledger.length, recovers.state.attempts]).toEqual([1, 3]);

		server.resetHandlers();

		const down = fakeProvider(["unavailable", "unavailable", "unavailable", "unavailable"]);

		await expect(client(FIXED).charge(ORDER)).rejects.toMatchObject({ reason: "unavailable" });
		expect(down.state.attempts).toBe(3);
	});
});

describe("msw 3 ignores the msw 2 option name", function renamedOptionSuite() {
	const server = setupServer();

	beforeAll(function listen() {
		// The msw 2 spelling. TypeScript rejects it, hence the cast; plain JavaScript passes it through.
		server.listen({ onUnhandledRequest: "error" } as never);
	});

	afterAll(function close() {
		server.close();
	});

	/**
	 * A local port with nothing listening on it: bind an ephemeral port, then release it.
	 *
	 * @returns The closed port.
	 */
	async function closedPort(): Promise<number> {
		const probe = createServer();

		probe.listen(0, "127.0.0.1");
		await once(probe, "listening");

		const { port } = probe.address() as AddressInfo;

		probe.close();
		await once(probe, "close");

		return port;
	}

	test('with `onUnhandledRequest: "error"` an unhandled request still goes to the network', async function oldOptionIgnored() {
		const warn = vi.spyOn(console, "warn").mockImplementation(function silence() {});

		try {
			const port = await closedPort();
			const error = await fetch(`http://127.0.0.1:${port}/charges`).catch(function caught(reason: unknown) {
				return reason;
			});
			const cause = (error as { cause?: { code?: string; message?: string } }).cause;

			// Blocked by msw, the cause would name the "error" strategy; refused by the OS, the request reached the network.
			expect(cause?.code).toBe("ECONNREFUSED");
			expect(String(cause?.message)).not.toContain('"error" strategy');
		} finally {
			warn.mockRestore();
		}
	});
});
