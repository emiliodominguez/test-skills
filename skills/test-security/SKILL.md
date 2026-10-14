---
name: test-security
description: "Security tests from schemas and an authorization matrix: hostile payloads, role checks, prototype pollution, replay safety, renderer hardening. Use when securing an API or IPC surface or after a break-in sweep. Hands off to `test-findings`."
metadata:
  stage: author
---

# Security tests

Every procedure, endpoint or IPC handler is called by every kind of caller with valid and
hostile input, and the answers are compared with an explicit, reviewed matrix. A security fix
without a test that would have failed is a regression waiting to happen.

## Process

1. **Enumerate the surface from code.** Read the router or contract registry and list every
   procedure with its input schema. The test iterates that list, so a new procedure is covered
   the day it is added.
2. **Generate valid input from the schema.** Convert the schema to JSON Schema, sample candidates
   from a small vocabulary per type, and keep the first one the schema accepts. Valid input
   matters: without it, a handler that refuses everything looks secure. Prefer a schema-driven
   generator (fast-check or Hypothesis from the schema, Schemathesis for OpenAPI or GraphQL; see
   `test-properties`) over a hand-rolled sampler.
3. **Authorization matrix.** Call each procedure once per caller state: signed out, each role,
   roles stripped, session locked. Compare the outcome code per cell with a golden file, or with
   explicit allowlists of public and any-signed-in procedures. Adding a procedure to an allowlist
   is the review: it states the procedure is meant to be open.
4. **Hostile variants** of each valid payload, per field and for the whole shape: `null`, `-1`,
   `NaN`, `1e309`, a decimal comma, impossible dates, a 1 MB string, `[]`, an object whose
   `toString` is `null`, nesting thousands deep, `__proto__`, `constructor` and `prototype` keys,
   an identifier belonging to another record or tenant, a 10k-element array.
5. **Assert the envelope, not just refusal.** Every answer is well formed, arrives within a time
   bound, and is never an internal error. Payloads the schema refuses are refused; payloads it
   accepts are not refused as invalid. `Object.prototype` and `Array.prototype` stay unpolluted
   on both sides of the boundary.
6. **Replay safety.** Re-send each successful command with the same idempotency key and assert
   nothing is written: row counts per table stay the same.
7. **Data exposure.** For each role, assert fields it must never receive (costs, margins,
   secrets) are absent from every response, and that known secrets never reach logs.
8. **Shell hardening, when there is a renderer process.** Statically check every window
   constructor for isolation, sandboxing, no node integration and web security on; preloads
   expose exactly one bridge and never the raw IPC object. Probe the built renderer: no Node
   globals, the bridge has exactly the expected keys, the content security policy blocks inline
   scripts, permissions are denied by default.
9. **Golden updates are security reviews.** Regenerate the matrix only through an explicit switch,
   then read the diff: every cell that turns from forbidden to anything else is a person who may
   now do something they could not.

## Out of scope: supply chain and static analysis

This skill tests the running surface. Dependency audit, secret scanning and static analysis
(SAST) are scanners, not tests: run them on every change with their own tools and docs, and
record each in the strategy table with its owner and what its findings block.

## From a sweep to tests

After a manual break-in sweep, each finding becomes a fix, a rule in the guide and a test that
fails without the fix. Record the date and the count of findings that had no failing test.

## Anti-patterns

- Testing only that bad input is refused, never that good input is accepted.
- Hand-written payload lists that miss new procedures.
- Regenerating the authorization golden to make a test pass without reading its diff.
- Rate-limit or origin checks that trust a client-controlled header without a test of the spoof.

## Done when

- Every procedure appears in the matrix and the hostile rounds, driven from the registry.
- Each fixed vulnerability has a test shown failing before the fix.
- Unchecked surfaces (third-party callbacks, file handlers) are listed.

Generate inputs with `test-properties`; triage anything these tests or a fuzzing run surface with
`test-findings`.
