# Fuzzing

Coverage-guided fuzzing mutates inputs toward unexplored code paths for minutes to days. The
oracle is usually a crash, a sanitizer report, a hang or an assertion inside the harness. It
finds what property-based tests rarely reach: deep parser states, memory errors, pathological
performance.

## Pick the fuzzer

| Stack | Fuzzer | Notes |
| --- | --- | --- |
| JavaScript, TypeScript | Jazzer.js | Jest integration (`fuzz` tests), bug detectors for prototype pollution and command injection |
| Python | Atheris | libFuzzer-based; `atheris.instrument_imports()` for coverage of pure Python |
| Go | `go test -fuzz` | Built in since Go 1.18; corpus under `testdata/fuzz` |
| Rust | cargo-fuzz | libFuzzer; `arbitrary` crate for structured input |
| C, C++ | libFuzzer, AFL++ | Build with sanitizers (address, undefined behavior) |
| Java, Kotlin | Jazzer | JUnit integration |
| HTTP APIs | Schemathesis, RESTler | Requests generated from OpenAPI or GraphQL schemas; checks status codes, schema conformance, server errors |

## Harness

- One entry point taking bytes (or a structured value built from them) and calling the code under
  test. Keep it deterministic and fast: no network, no disk beyond temp files, no global state
  that survives between inputs.
- Turn semantic checks into assertions inside the harness: a decoded value re-encodes to the same
  bytes; a parsed document validates against its schema.
- Catch the expected refusals (a typed parse error) so only unexpected failures count.

## Corpus and dictionaries

- Seed the corpus with real samples (a few valid files, recorded requests) and with values from
  the property-based generators; fuzzers start far faster from valid inputs.
- Add a dictionary of the format's tokens (keywords, delimiters, magic numbers).
- Commit a minimized corpus; re-run it as a regression suite on every change, which costs seconds.

## Budget and CI

- On every change: replay the committed corpus (fast, deterministic).
- Scheduled: fuzz each target for a fixed time (30 minutes to hours), keep new corpus entries and
  crashes as artifacts. ClusterFuzzLite or OSS-Fuzz run this for open-source projects.
- Every crash becomes a committed regression input and an ordinary unit test once understood.

## When not to fuzz

Business rules with semantic oracles (totals, permissions) belong in property-based tests: a
fuzzer has no notion of a wrong total unless the harness asserts it, and it spends its budget on
byte-level mutations the domain never produces.
