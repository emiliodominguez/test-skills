---
name: test-integration
description: "Integration tests on real databases, brokers and APIs: migrations, contracts, faults. Use when mocks hide bugs, or for Testcontainers, Pact, migration, retry or timeout tests. Hands off to `test-e2e` or `test-findings`."
compatibility: "Evidence verified on Node 22.22 node:sqlite (SQLite 3.50), msw 3.0, zod 4.6 and fast-check 4.10. Testcontainers, docker compose, Pact, WireMock and Toxiproxy guidance was not run here."
metadata:
  stage: author
---

# Integration tests

Test the code where it meets something it does not own: a database engine, a broker, a cache,
object storage, another service. Bugs there live in the seam (constraints, collation, NULL
ordering, transactions, serialization, schema drift, timeouts, retries) and a mock cannot have
them. Success is one test per seam in scope that failed on a real or seeded bug, passes on the
fix, runs isolated and in parallel, and fits a stated time budget.

## Where it sits

| Level | Runs | Dependencies | Catches |
| --- | --- | --- | --- |
| `test-unit` | In process | Pure code, fakes speaking the protocol | Logic, mapping, validation |
| Integration (this skill) | One service or module | The real engine, broker or cache; other services through a contract or a stub checked against it | SQL semantics, migrations, serialization, drift, timeouts, retries, duplicates |
| `test-e2e` | The whole system | Everything deployed together, driven through the UI | A user path working across all of it |

If a test needs a browser to reach the bug, it is `test-e2e`. If it needs no I/O to reach it,
move it down to `test-unit`: integration tests are slower and should only cover what lives in
the seam.

## Process

1. **List the seams the change touches.** Queries and transactions, migrations, published or
   consumed messages, cache reads and writes, files and buckets, outbound HTTP or gRPC, and any
   API other teams consume. For each, name the failure that would hurt: lost or duplicated
   write, money created, wrong order, a consumer broken by a field change, a request that hangs.
   A seam with no behavior beyond passing data through needs no test of its own.
2. **Pick the stand-in per dependency:**

   | Dependency | Use | Never |
   | --- | --- | --- |
   | Database | The production engine and major version in a container, pinned tag, same extensions, collation and time zone | Another engine (H2, SQLite for PostgreSQL), or a mocked client or ORM |
   | Broker, queue | The real broker in a container (Kafka or Redpanda, RabbitMQ, LocalStack or ElasticMQ for SQS) | An in-memory bus to test delivery, ordering or redelivery |
   | Cache | Real Redis or Memcached | A `Map` to test TTL, eviction or serialization |
   | Object storage | MinIO, LocalStack, fake-gcs-server; a temporary directory for local files | A mocked SDK |
   | A service you own | Contract tests on both sides, plus the real service in compose for a few flows | Full stack per change for what a contract catches |
   | Third-party API | HTTP-level stub (msw, nock, WireMock) checked against the vendor's schema; the vendor sandbox on schedule | The live vendor in the per-change suite |

   Read [references/containers.md](references/containers.md) to run engines with Testcontainers
   or docker compose, locally and in CI.
3. **Isolate every test.** Choose per suite:
   - **Transaction per test, rolled back:** fastest. Invalid when the code commits, opens its own
     transaction, uses a second connection, or depends on locks, isolation levels, deferred
     constraints or after-commit hooks. Code that must nest uses savepoints.
   - **Database or schema per worker:** cloned from a migrated template; the default for
     parallel runs. Truncate between tests within a worker.
   - **Unique keys per test** (tenant, prefix, topic suffix): only on a shared environment, with
     every assertion filtered to the test's own keys.

   Read [references/databases.md](references/databases.md) for the trade-offs, engine gotchas and
   seeding.
4. **Seed through factories with production-shaped data.** A minimal valid default with
   per-test overrides; through the domain API where invariants matter. Include what real data
   holds: NULLs, mixed case, unicode, maximum lengths, amounts like 0.29 and 19.99, legacy
   duplicates. Assert on business keys, not generated ids or sequence values.
5. **Test migrations on data, not on an empty schema.** For each migration: up on seeded data
   with assertions on the values (not that a column exists), down or the documented rollback,
   the runner re-run after a failure, and old application code against the new schema when
   deploys are expand then contract. Rehearse on an anonymized production-size copy on schedule
   and record the lock time of each step.
6. **Pin the contract at every service boundary.**
   - **Consumer-driven (Pact):** consumers record the interactions they rely on, the provider
     verifies them in its pipeline, and a deploy gate asks whether this version is compatible
     with what is deployed. Fits few, known consumers that you own.
   - **Schema-based:** the provider publishes OpenAPI, JSON Schema, GraphQL SDL, AsyncAPI or
     protobuf; consumers validate what they read against the part they rely on; CI diffs every
     schema change for breaking changes. Fits many or unknown consumers, events and third parties.

   Either way, consumers are tolerant readers (unknown fields ignored), and a removed or renamed
   field, a changed type, a field that becomes optional or nullable, or a new enum value in a
   response is breaking. Read [references/contracts.md](references/contracts.md).
7. **Inject faults at every outbound boundary.** Timeout, slow response, connection reset, a
   response lost after the provider committed, 5xx and 429 with `Retry-After`, 4xx, a malformed
   or truncated body, partial batch failure; for messages, duplicates, reordering and poison
   messages. Assert what must hold: the caller's latency is bounded, only keyed or idempotent
   calls are retried, attempts are bounded with backoff, side effects are counted exactly once,
   and the caller gets a typed error. Read [references/faults.md](references/faults.md) for the
   catalog and how to inject each fault.
8. **Wait on conditions, never on time.** Asynchronous effects (a consumer handled the message, a
   projection caught up) are polled with a deadline and a clear failure message. A fixed sleep
   is either flaky or slow.
9. **Prove each test bites.** Remove the transaction, drop the idempotency key, truncate instead
   of rounding, or run against the previous release, and watch the test fail.
10. **Split per change and scheduled.**

    | Per change | Scheduled |
    | --- | --- |
    | Seams the diff touches, engines pinned to the production version | Engine version matrix and the next major version |
    | Migrations up on seeded data, re-run, down | Migration rehearsal on a production-size copy, with timings |
    | Contract verification and schema diff | Vendor sandbox calls; re-recording stubs and diffing them |
    | In-process HTTP fault injection | Network faults with a proxy (Toxiproxy) against real engines |

    Start each engine once per run or per worker, not per test. When the per-change stage
    outgrows the team's budget, split by service or tag rather than dropping seams.

## Measured in this repository

`test/integration-examples.test.ts` runs every claim below against the modules in
`examples/integration/`, with a buggy and a fixed variant of each, on Node 22.22 `node:sqlite`
(SQLite 3.50.4), msw 3.0.3, zod 4.6.7 and fast-check 4.10:

- **Mocked client against the real engine.** One mock-based test passes on three repository
  bugs. Against SQLite: an overdraft hits the CHECK constraint after the credit was written
  (total balance 6,000 becomes 11,000); a transfer to an unknown account updates zero rows
  without error (6,000 becomes 5,300); `=` misses an email that differs in case; undated tasks
  sort first because SQLite puts NULL first in ascending order.
- **Rollback-per-test isolation.** Inside the test's transaction a second `BEGIN` fails with
  "cannot start a transaction within a transaction"; a savepoint nests, and the outer rollback
  restores the seed.
- **Migrations.** The buggy money migration goes up and down cleanly on an empty database. On
  six seeded amounts it loses a cent on four (19.99 becomes 1,998 cents). A fast-check round
  trip finds it in 200 runs, but shrinking stalls on a large value because the failing set is
  sparse (0.29, 0.57 and 0.58 fail; 0.30 passes). A non-atomic runner that fails halfway leaves
  a new column at the old version, and the re-run fails on "duplicate column name"; the atomic
  runner rolls back and succeeds once the duplicate row is removed.
- **Contracts.** The consumer's stubbed test passes while the provider sends `total_cents` as a
  string, and the unvalidated consumer computes `"1999500"` without any error. Verifying the
  consumer's interactions against the running provider passes versions 1 and 2 (an added field)
  and names `total_cents` in version 3. A diff of the published schemas flags the type change, a
  removed field and a new enum value, and passes the added field.
- **Faults with msw.** A response lost after the charge: two charges without an idempotency key,
  one with. A one-second stall: the client without a timeout waits it out; with a 100 ms timeout
  and a keyed retry it finishes in under half the stall with one charge. A 422 is retried to the
  budget by the buggy client and once by the fixed one. A malformed 200 is returned as a charge
  without an id, or refused. Two 503s then success: three attempts, one charge.
- **msw 3 renamed the unhandled-request option.** `onUnhandledFrame: "error"` fails unmatched
  requests; the msw 2 name `onUnhandledRequest` is ignored at runtime and the request goes to
  the real network.

No container runtime was available, so Testcontainers, compose, Pact, WireMock, Toxiproxy and
the PostgreSQL and MySQL behaviors in the references come from their documentation, not from
runs here.

## Anti-patterns

- A mocked database client or ORM in a test named integration: it passes on every SQL bug.
- A different engine standing in for production: NULL ordering, collation, types, transactional
  DDL and locking all differ.
- Migrations tested only on an empty database, or asserting the column exists instead of the
  values in it.
- One long-lived shared test database, tests that depend on order, ids asserted by value.
- Hand-written stubs of another service with nothing checking them against its contract.
- Retries without an idempotency key, or fault tests that assert only "it throws".
- The live third-party API in the per-change suite; image tags such as `latest`.
- A full-stack or browser test for a bug a contract or a single real dependency catches.

## Done when

- Every seam in scope is listed with its stand-in, isolation strategy and per-change or
  scheduled slot.
- Each test was shown failing on a seeded bug or the previous release, with the command and the
  discovered test count recorded.
- Migrations are tested up on seeded data, re-run after failure, and down or rolled back.
- Each service boundary has a contract verified on both sides, or a schema diff gate in CI.
- Each outbound dependency has fault tests asserting bounded latency and exactly-once side effects.
- The suite passes repeatedly in parallel from a clean state, with engine versions pinned.

Drive whole-system paths through the UI with `test-e2e`; triage failures with `test-findings`
and intermittent ones with `test-flaky`.
