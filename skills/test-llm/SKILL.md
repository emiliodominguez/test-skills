---
name: test-llm
description: "Testing LLM features: mocked-model tests, output contracts, evals with per-case baselines. Use when changing a prompt, model, RAG or agent, or adding evals or LLM-as-judge. Hands off to `test-flaky` or `test-findings`."
compatibility: "Mocks verified with ai 7.0.139 (MockLanguageModelV4), zod 4.6 and msw 3.0 in this repository's examples; the split, contracts and eval method apply to any SDK, provider or language."
metadata:
  stage: author
---

# LLM feature tests

Most defects in a model-backed feature live in ordinary code around the model call: the prompt
it builds, the parser, the tool dispatcher, the retry policy, the output guard. Test that code
deterministically with a mocked model, put a schema contract on every model output, and judge the
model's behavior with an evaluation suite compared per case against a baseline. Success is a
suite where a prompt or model change that breaks five cases fails the gate, even when five other
cases improve and the aggregate score does not move.

## Process

1. **Split the feature at the model call.** List the deterministic pieces and test each with a
   mocked model on every change, in seconds, for free:

   | Piece | Typical bug | Assert on |
   | --- | --- | --- |
   | Prompt assembly | Locale, plan, date or retrieved context dropped; history truncated from the wrong end; user text in the system prompt | The prompt the mock received |
   | Tool definitions | Schema looser than the handler expects; descriptions that invite the wrong tool | Schemas against handler inputs |
   | Output parsing | Schema-invalid output accepted; prose around JSON rejected; truncation parsed as data | A table of malformed outputs |
   | Tool dispatch | Model's arguments overridden by defaults; unknown tool executed; invalid arguments not refused | Recorded tool calls |
   | Retries, fallbacks, timeouts | Whole turn retried, re-running side effects; non-retryable errors retried; fallback model gets a prompt it cannot handle | Side effects counted in a fake |
   | Output guards | Redaction per stream chunk; citations rendered for ids that were never retrieved | The bytes sent to the client |

   Read [references/mocking.md](references/mocking.md) for mock models per SDK, scripting by
   prompt content, streams and HTTP-level mocks.
2. **Mock at the SDK seam, script by what was sent.** Inject the model. Have the mock decide by
   the prompt it receives (last message is a tool result, a phrase is present), not by call
   index, so a retry or an extra step does not silently shift every answer. Turn the SDK's own
   retries off in tests so they do not mask the feature's. Assert on the recorded calls and on
   side effects in fakes, never on the mock's canned reply.
3. **Put a contract on every structured output.** Validate at the boundary with a strict schema
   (enums, integer amounts, unknown keys refused) and return typed failures: `truncated`
   (finish reason was the token limit), `refusal` (content filter or refusal text), `not-json`,
   `schema`. Recover only what is unambiguous: a fenced block or JSON wrapped in prose. Allow at
   most one repair call with the validation errors in the prompt, count it, and never coerce
   types or fill defaults for missing fields. Test the parser with a table of malformed outputs.
4. **Build the eval set from real traffic.** Sample production inputs (anonymized), stratify by
   slice (intent, locale, length, customer tier), and over-sample complaints, escalations and
   known failures. Start at 50-200 cases with stable ids, tags and a source; add every
   production failure as a case before fixing it. Hand-written cases cover what traffic has not
   shown yet: adversarial inputs, empty and huge inputs, other languages. Read
   [references/evals.md](references/evals.md) for dataset format, versioning and splits.
5. **Pick the cheapest assertion that captures the requirement**, per case:

   | Requirement | Assertion |
   | --- | --- |
   | Label, enum, routing decision, tool choice | Exact match |
   | Must mention, must not mention | Contains, not-contains (normalize case and whitespace) |
   | Format: dates, ids, greeting, language | Regex or schema |
   | Amounts, scores, counts | Numeric with a stated tolerance |
   | Field must be absent (no refund on a question) | Absent |
   | Free text against a reference answer | Reference metric (token F1, embedding similarity) as a screen, not a gate |
   | Tone, helpfulness, correctness of reasoning | LLM-as-judge with a rubric, calibrated |
   | "Is the new version better" | Pairwise judge, both orders |

   Deterministic assertions first: they are free, exact and never drift. A judge is a model
   under test too: write a rubric of binary criteria, pin the judge model and prompt, and
   calibrate it against 50-100 human-labeled cases before trusting it (agreement and Cohen's
   kappa per criterion, each kappa with its confidence interval and the class balance, and
   agreement per class when passes far outnumber failures; under about 0.6, fix the rubric).
   Recalibrate when the judge changes.
6. **Gate on per-case flips against a baseline.** Store the baseline run per case (dataset
   version, prompt version, model id, settings, outputs, assertion results). Pin a dated model
   snapshot id, never a floating alias: an alias that moves between runs makes flips meaningless. On every prompt,
   model, retrieval or parameter change, run the candidate on the same dataset version and
   report every `PASS -> FAIL` and `FAIL -> PASS` case with the failing assertion. Fail the gate
   on any unreviewed `PASS -> FAIL`, and on any failure in a critical slice (safety, money,
   refunds), regardless of the aggregate. Accepted regressions are listed by case id with a
   reason. Show the aggregate only with its confidence interval.
7. **Measure the noise floor before reading flips.** Run the baseline against itself with a
   different seed. Flips there are noise; a candidate's flips mean something only above that
   floor. At temperature 0 the floor should be zero; if it is not, the provider is not
   deterministic for this request and the gate needs samples:
   - Draw k samples per case (5-25) and pass a case on a stated rule: majority, or all k
     (pass^k) for actions with side effects. pass@k suits generate-then-verify flows only.
   - Fix seeds where the provider supports them and record them; never treat a seed as a
     guarantee across model versions.
   - Size the set for the effect you need to see. 20 cases at 80% give a 95% interval of about
     58-92%. Unpaired, detecting a 5-point drop from 80% at 80% power and alpha 0.05 needs
     about 1,100 cases per arm (10 points: about 290). Paired per-case comparison needs fewer, because only discordant cases
     count; report the exact McNemar p-value on the flips.
8. **Test retrieval and generation separately** in RAG. Recall@k and MRR on labeled queries
   decide chunking, embedding and reranking changes; faithfulness (every claim supported by the
   retrieved text), citation correctness and abstention on unanswerable questions decide prompt
   changes, with retrieval fixed from fixtures. Read [references/rag.md](references/rag.md).
9. **Assert agent trajectories, not transcripts.** Tool choice and arguments, ordering
   constraints that matter (lookup before refund), forbidden tools, approvals before side
   effects, and budgets on steps, tokens, cost and wall time. Accept any path that reaches the
   right end state when several are valid. Read [references/agents.md](references/agents.md).
10. **Keep a safety slice in every run.** Indirect prompt injection in retrieved documents and
    tool outputs, canary secrets and PII in context that must never reach output, a jailbreak
    set with its benign near misses (measure over-refusal too), and output guards tested at
    stream boundaries. Read [references/safety.md](references/safety.md).
11. **Budget cost and latency per case.** Record input, output and cached tokens, cost and
    latency for each case; gate on p95 latency, cost per case and steps per task against the
    baseline (for example, fail above +20% cost or +500 ms p95 unless accepted). A cheaper
    model that passes the same cases is a result worth reporting.
12. **Tier the runs:**

    | Tier | When | Model | Gate |
    | --- | --- | --- | --- |
    | Mocked-model unit tests | Every change | Mock | Must pass |
    | Smoke eval | Every change to prompts or wiring | Small local model (for example through Ollama) or the cheapest hosted model | Pipeline runs end to end, outputs parse; not quality |
    | Full offline eval | Prompt, model, retrieval or parameter change; nightly | Production model and settings | Per-case flips, critical slices, budgets |
    | Online eval | Continuously | Production traffic, sampled | Judge scores, user signals, guard hits, drift alerts |

    A local model answers "does the pipeline still work", never "is quality unchanged": its
    failure modes differ from the production model's. Online evaluation feeds new cases back
    into the offline set; it never replaces the offline gate.

## Tools

Eval frameworks are options, not requirements; a few hundred lines of harness (dataset, assertion
functions, baseline file, flip report) cover most teams. promptfoo (assertions and matrices in
config), Braintrust and LangSmith (datasets, experiments, tracing, online scoring),
provider-published eval frameworks, DeepEval (pytest-style metrics), Ragas (RAG metrics) and
Inspect (task, solver and scorer pipelines, agent evals) are common choices. Whichever is used, check that it reports results per
case against a baseline and can export them; an aggregate dashboard alone hides regressions.

## Measured in this repository

`test/llm-examples.test.ts` runs a support-ticket triage feature (`examples/llm/triage.mjs`)
with `MockLanguageModelV4` from `ai/test` (ai 7.0.139). Each seeded bug is caught by a
mocked-model test and the test passes on the fix: the customer's locale missing from the system
prompt the model received; a parser that accepted five schema-invalid outputs (invented enum,
missing field, unknown key, negative amount, amount as string); a dispatcher whose ticket
defaults overrode the order the model chose; a retry around the whole turn that issued a second
refund after a transient failure; and per-chunk redaction that leaked an address split across
two streamed chunks (`simulateReadableStream`). The SDK's `Output.object` with the same zod
schema threw `NoObjectGeneratedError` on malformed and on schema-invalid text. MSW 3.0 tests of
an HTTP client caught retries of a 400 and checked that `Retry-After` was honored.

The offline harness (`examples/llm/eval.mjs`, 20 golden cases, deterministic stub model) ran a
simulated prompt change: both runs scored 16/20 (80%, 95% CI 58-92%), exact McNemar p=1, yet
two cases flipped `PASS -> FAIL` and two `FAIL -> PASS`, and the per-case gate failed. The same
prompt against itself at temperature 0 had no flips; at temperature 0.6, one sample per case
flipped 1-4 cases on each of 8 seeds (the test asserts that range), and a majority over 25
samples had no flips on any of them; with the same settings, the simulated prompt change still
showed both real regressions. The ticket fence escapes `<` and `>` in customer text, and a test
asserts that a body containing `</ticket>` stays inside it.

## Anti-patterns

- Gating a prompt or model change on the aggregate score: improvements cancel regressions.
- Calling a real model in unit tests, or asserting on the mock's canned reply instead of on what
  the code sent and did.
- Mocks scripted by call index, so one extra retry shifts every answer.
- `JSON.parse` and a type cast as the output contract; defaults filled in for missing fields.
- Retrying a whole agent turn after tools with side effects ran; tools without idempotency keys.
- An LLM judge nobody calibrated against human labels, or the same model judging itself with no
  check for self-preference.
- Eval sets written only by the developer, never refreshed from traffic, with no failure cases.
- Reading a 3-point change on 50 cases as a result; one sample per case at temperature above 0.
- RAG judged only end to end, so a retrieval regression looks like a prompt problem.
- Comparing runs on different dataset versions, or overwriting the baseline to make a gate pass.
- Using a small local model's eval score as evidence about the production model.

## Done when

- Every deterministic piece around the model has a mocked-model test that was shown failing on
  a deliberate bug.
- Every structured output is schema-validated with typed failures, and the malformed-output
  table passes.
- The eval set has stable ids, slices, a source per case and a version; the baseline is stored
  per case with prompt, model and settings.
- The gate reports per-case flips with the failing assertion, the noise floor is measured, and
  the sample size and samples per case are stated with the interval.
- RAG retrieval, agent trajectories, the safety slice and cost and latency budgets are covered
  where the feature has them, or listed as gaps with an owner.

Measure an eval that flips on its own with `test-flaky`; triage a confirmed regression with `test-findings`.
