# Contracts

A contract test checks one side of a boundary against an agreement the other side also checks,
so neither side's stub can drift silently. It replaces most cross-service end-to-end tests: the
two services never run together in the per-change suite.

## Which kind

| | Consumer-driven (Pact) | Schema-based |
| --- | --- | --- |
| Source of truth | What each consumer actually uses | What the provider publishes |
| Who writes tests | Consumers record interactions; provider verifies them | Provider validates its responses; consumers validate what they read; CI diffs schemas |
| Fits | Few known consumers you own, request-response APIs and messages | Many or unknown consumers, public APIs, third parties, event streams |
| Catches | Any change that breaks a real consumer, and only those | Any change that breaks the published schema, used or not |
| Needs | A broker for pacts and verification results; provider states | Schemas kept accurate: validated against real responses |

Many teams combine them: schema diff gates every change, consumer-driven contracts protect the
few critical integrations.

## Consumer-driven flow

1. The consumer's test runs its real client against a mock provider that records each
   interaction: request, the response fields used, and matchers (type, regex, array shape)
   rather than literal values.
2. The pact file is published to a broker, tagged with the consumer's version and branch.
3. The provider's pipeline replays every interaction against the real provider, with **provider
   states** ("order o-1 exists and is paid") set up through test hooks that seed data. Results
   are published back to the broker.
4. Before deploying either side, the pipeline asks the broker whether this version is verified
   against the versions deployed in the target environment (`can-i-deploy`), and records the
   deployment afterwards.
5. New consumer expectations can start as pending, so they do not break the provider's build
   until verified once. That happens only when the provider's verification enables pending pacts
   (`enablePending` in pact-js and most other implementations) and the pacts come from a broker
   that supports them (Pact Broker or PactFlow); otherwise every new expectation fails the
   provider build immediately.

Keep interactions minimal: only fields the consumer reads, matchers instead of literals. A pact
that pins every field is a snapshot and breaks on harmless changes.

## Schema-based flow

- **Provider side:** validate real responses in the provider's own integration tests against
  the published OpenAPI or JSON Schema (response validation middleware, or a test helper that
  validates every recorded response). A schema nobody validates drifts like a stub.
- **Consumer side:** parse at the boundary with a schema of what the consumer relies on (zod,
  pydantic, JSON Schema). A consumer that trusts the body turns drift into silent wrong values:
  in this repository, `total_cents` arriving as `"1999"` made `total + 500` equal `"1999500"`
  with no error.
- **Change gate:** diff the proposed schema against the deployed one on every change: `oasdiff
  breaking` for OpenAPI, `graphql-inspector diff` for GraphQL, `buf breaking` for protobuf, the
  AsyncAPI diff tool for event specs, a schema registry compatibility mode (BACKWARD, FORWARD,
  FULL, transitive variants) for Avro, protobuf or JSON Schema events.
- **Third parties:** validate stubs against the vendor's published schema, and run a small
  sandbox check on schedule that compares live responses with it.

## Breaking or not

| Change | In a response (consumers read) | In a request (consumers send) |
| --- | --- | --- |
| Add an optional field | Compatible, if consumers ignore unknown fields | Compatible |
| Add a required field | Compatible | Breaking |
| Remove or rename a field | Breaking | Compatible if the provider ignores it |
| Change a type or format | Breaking | Breaking |
| Make a field optional or nullable | Breaking | Compatible |
| Make a field required | Compatible | Breaking |
| Add an enum value | Breaking unless consumers have a fallback | Compatible |
| Remove an enum value | Compatible | Breaking |
| Tighten validation (length, pattern, range) | Compatible | Breaking |

Events follow the response column for consumers and the request column for producers. Old
messages stay in topics and queues, so a consumer must read every schema version still retained.

## Versioning

- Prefer additive change and tolerant readers over version bumps.
- For a breaking change: expand (add the new field or endpoint), migrate consumers, verify no
  consumer uses the old one (broker data, access logs), then contract. Each step is a separate
  deploy with its own contract run.
- A new major version is a new contract; keep verifying the old one until its last consumer is gone.
