# Databases

## Isolation strategies

| Strategy | Cost per test | Parallel | Breaks when |
| --- | --- | --- | --- |
| Transaction per test, rolled back | Lowest: no cleanup | Yes, one connection per test | Code commits or opens its own transaction; a second connection (a pool, a worker, the app under test in another process) cannot see uncommitted rows; tests of locks, isolation levels, deferred constraints, triggers or after-commit hooks |
| Database or schema per worker, cloned from a migrated template | One clone per worker | Yes | Rarely; the template must be rebuilt when migrations change |
| Truncate all tables between tests | Grows with table count | Per worker | Sequences not reset; triggers or foreign keys need `CASCADE`; forgotten tables leak rows |
| Fresh database per test | Highest for server engines; negligible for embedded in-memory engines | Yes | Slow beyond a few hundred tests on a server engine |
| Unique keys per test on a shared database | None | Yes | Any assertion on counts or "all rows"; any global table |

Nested transactions differ by engine. SQLite refuses a second `BEGIN` ("cannot start a
transaction within a transaction", verified in this repository). PostgreSQL warns "there is
already a transaction in progress" and continues, so the code's `COMMIT` commits the test's
transaction and the rollback no longer isolates. MySQL is worse: a `BEGIN` (or `START
TRANSACTION`) inside an open transaction implicitly commits it, and so does any DDL statement
(`CREATE`, `ALTER`, `DROP`, `TRUNCATE`), so code under test that does either silently commits
the test's transaction. Code that may run inside a caller's transaction
uses `SAVEPOINT`, `RELEASE` and `ROLLBACK TO`; ORMs expose this as nested transactions.

With a per-worker database, give each worker its name from the runner's worker index, migrate a
template once per run, and clone it per worker (PostgreSQL `CREATE DATABASE w3 TEMPLATE app_template`;
MySQL and others: restore a dump or copy the data directory). Clone per test only when cloning is
cheap compared with the test.

## Engine fidelity

Behaviors that make another engine a false stand-in:

| Behavior | SQLite | PostgreSQL | MySQL |
| --- | --- | --- | --- |
| NULL position, ascending | First (verified here) | Last | First |
| `=` on text with different case | No match with the default binary collation (verified here) | No match unless `citext` or a nondeterministic collation | Match under the default case-insensitive collations |
| DDL inside a transaction | Transactional (verified here) | Transactional, except `CREATE INDEX CONCURRENTLY` and a few others | Implicit commit: a failed migration step stays half applied |
| Sequence values after rollback | Rowid reused | Not rolled back: gaps | Auto-increment not rolled back |
| Types | Dynamic typing, affinity | Strict | Strict mode depends on `sql_mode` |

Also differ: timestamp time zones and precision, decimal rounding, `LIMIT` without `ORDER BY`
(order is never guaranteed), upsert syntax and semantics, JSON operators, full-text search, lock
granularity, and error codes the code maps to domain errors. Map constraint errors by the
engine's code (SQLite extended code 275 for CHECK, PostgreSQL SQLSTATE `23514`), never by message
text.

## Seeding

- **Factories** build one valid row with defaults and accept overrides: `account({ balanceCents: 0 })`.
  The test states only what matters to it.
- **Through the domain** when invariants span tables (an order with lines and totals); raw
  inserts only for data the domain cannot produce, such as legacy rows.
- **Production shapes:** NULL in every nullable column, mixed case, unicode and long values,
  boundary amounts, duplicates legacy data holds, rows from before each migration.
- **Seed once, clone per worker** when seeding dominates run time.
- **Anonymized production snapshots** for migration rehearsals and query-plan checks, on schedule:
  never raw personal data in CI.

## Migrations

| Check | Catches |
| --- | --- |
| Up on an empty database | Syntax and ordering only |
| Up on seeded data, asserting values | Lossy conversions (truncation where rounding was meant), defaults that overwrite data, dropped rows |
| Up, down, up | A down migration that does not restore, or leaves objects behind |
| Runner re-run after a failing step | Non-atomic steps, missing version bookkeeping |
| Up on duplicates and NULLs that real data holds | Unique or NOT NULL constraints that fail in production |
| Previous release's tests against the new schema | Expand-then-contract violations: a column dropped while old code still reads it |
| Timed on a production-size copy (scheduled) | Table rewrites and long locks |

A property over generated values (see `test-properties`) is a cheap way to cover a data
conversion; seed the known edge values as fixed examples too, because a sparse failing set
shrinks poorly.

On engines without transactional DDL, keep one statement per migration step, or make every step
safe to re-run (`IF NOT EXISTS`, `IF EXISTS`).

## Queries

- Assert the result set and its order, with `ORDER BY` on a unique tiebreaker.
- Query plans: for every index added for a query, assert the plan uses it (`EXPLAIN`; PostgreSQL
  `EXPLAIN (FORMAT JSON)`, MySQL `EXPLAIN FORMAT=JSON`, SQLite `EXPLAIN QUERY PLAN`), so a later
  rewrite that stops using it fails a test. Run it on the production engine and major version:
  planners differ by engine and version, so a plan check on another engine proves nothing.
  Seed enough rows that the planner prefers the index (a table of a few rows is scanned whatever
  the indexes), and assert the index name or the absence of a sequential scan, not the whole plan
  text. A query that got slow without issuing more queries is usually a plan regression; this is
  where it is caught.
- For concurrency (double booking, lost update, unique races), run the competing operations on
  separate connections with a barrier and assert one wins; transaction-per-test isolation cannot
  test this.
