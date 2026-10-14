# Real engines in containers

Nothing in this file was run in this repository (no container runtime was available). It is
distilled from the Testcontainers and Docker documentation; check the versions you use.

## Testcontainers or compose

| | Testcontainers | docker compose |
| --- | --- | --- |
| Lifecycle | Owned by the test process: started in setup, removed by a reaper (Ryuk) even if the run crashes | Owned by the pipeline or the developer: `up --wait` before, `down -v` after |
| Ports | Random host ports, read from the container object | Fixed or declared in the file |
| Best for | One or a few dependencies per suite, any developer machine, per-worker instances | A multi-service stack shared by several suites; the same file for local development |
| Languages | Java, Go, .NET, Node, Python, Rust and others, with modules for common engines | Any |

Both need a container runtime on the machine or CI runner (Docker, Podman, or a remote or cloud
runtime).

## Patterns

- **Pin images** to a version, ideally the digest, matching production: `postgres:17.6`, not
  `postgres` or `latest`. A drifting image is a flaky test that appears overnight.
- **Start once, not per test.** One container per run in the runner's global setup, or one per
  worker for parallel runs; isolate tests inside it (see `databases.md`). Starting an engine
  takes seconds, so per-test containers only suit a handful of tests.
- **Wait for readiness, not for the port.** Use the module's wait strategy (a log line, a health
  check, a successful query). An open port is not a ready database.
- **Migrate once, then snapshot.** Run migrations into the fresh container, then clone a template
  database per worker or snapshot the container (where the library supports it) so each test
  starts from the migrated state.
- **Speed up durability you do not need.** Data directory on tmpfs; for PostgreSQL,
  `-c fsync=off -c synchronous_commit=off -c full_page_writes=off`. Never in production.
- **Reuse locally, never in CI.** Reuse flags keep a container alive between local runs (Java:
  `testcontainers.reuse.enable=true` in the user's properties file plus `withReuse(true)`). In CI,
  start fresh so state never leaks between pipelines.
- **Pass connection details through the environment** of the process under test, read from the
  container (`getConnectionUri()`, mapped host and port), never hard-coded.

Sketches (not run here):

```ts
// Node, in the runner's global setup: one PostgreSQL for the whole run.
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";

let container: StartedPostgreSqlContainer;

/** Start the database and expose its URL to the test workers. */
export async function setup() {
	container = await new PostgreSqlContainer("postgres:17.6").start();
	process.env.DATABASE_URL = container.getConnectionUri();
}

/** Stop the database after the run. */
export async function teardown() {
	await container.stop();
}
```

```python
# Python, pytest: one container per session, a transaction per test on top.
import pytest
from testcontainers.postgres import PostgresContainer

@pytest.fixture(scope="session")
def database_url():
    """Start PostgreSQL once for the session and yield its connection URL."""
    with PostgresContainer("postgres:17.6") as postgres:
        yield postgres.get_connection_url()
```

```java
// Java, JUnit 5: a static container shared by the class.
@Testcontainers
class OrderRepositoryTest {
    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:17.6");
}
```

## Compose for a stack

- Give every service a `healthcheck` and start with `docker compose up --wait`, so the tests start
  only when every service reports healthy.
- Use a project name per pipeline run (`-p run-1234`) so parallel pipelines on one host do not
  share containers or volumes.
- Seed with an init container or a migration job that the application services depend on with
  `condition: service_completed_successfully`.
- Always tear down with `docker compose down -v` in a step that runs on failure too, and collect
  `docker compose logs` as an artifact before it.

## CI

- Prefer runners with a container runtime available to the job; Docker-in-Docker works but is
  slower and needs privileges. CI service containers (declared next to the job) suit one or two
  fixed dependencies.
- Pull or cache images before the timed test step, so registry rate limits and slow pulls do
  not look like slow tests.
- Set CPU and memory limits close to what the runner has; an engine sized for a laptop can be
  killed on a small runner.
- Record the image versions and the runtime version in the job output; they are part of the
  evidence when a test fails only in CI.
