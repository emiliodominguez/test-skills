# Evaluation suites

An eval suite is a dataset, an assertion per requirement, a stored baseline and a comparison
that reports cases, not just a score.

## Dataset

One case per line (JSONL), versioned with the code:

```json
{"id":"billing-refund-login-email","source":"sampled from support traffic, anonymized","tags":["billing","refund","ambiguous"],"input":{"subject":"Refund","body":"Please refund order A-1002 ($19.99). I also changed my login email last week.","locale":"en-GB"},"expect":[{"type":"schema"},{"type":"equals","path":"category","value":"billing"},{"type":"numeric","path":"refundCents","value":1999,"tolerance":0}]}
```

- **Stable ids** that describe the case. Comparisons join on id; renumbering breaks history.
- **Source** per case: sampled traffic (with the sampling window), production incident,
  hand-written adversarial, synthetic. Synthetic cases written by a model inherit its blind
  spots; label them and keep them a minority.
- **Slices** as tags: intent, locale, input length, customer tier, `critical`, `safety`,
  `ambiguous`. Report pass rates per slice; a slice under 30 cases is anecdotal.
- **Sampling from traffic:** stratify so rare intents are present, over-sample escalations,
  thumbs-down, retries and long sessions, deduplicate near-identical inputs, anonymize before
  the data leaves production. Re-sample quarterly or when the input mix shifts.
- **Labels:** two annotators on a subset, measure agreement, and resolve disagreements in a
  written guideline. A case annotators disagree on is a bad gate case; keep it as a judged case
  or drop it.
- **Splits:** a development set you iterate prompts on, and a held-out set you only run at the
  gate. Iterating on the gate set overfits the prompt to it.
- **Versioning:** a dataset version in the baseline file. Adding cases creates a new version;
  rerun the baseline on it before comparing.

## Assertions

Write the case's requirement, then the cheapest check that would fail when it is broken.

| Type | Holds when | Notes |
| --- | --- | --- |
| `schema` | Output parses and validates | Run the production parser, not a test copy |
| `equals` | A field equals a value | Labels, enums, tool names, booleans |
| `contains` / `not-contains` | Text includes or excludes a string | Normalize case, whitespace and Unicode first |
| `regex` | Text matches | Greeting language, id formats, no markdown in plain-text channels |
| `numeric` | Within a tolerance | State the tolerance in the case, not in the harness |
| `absent` | A field is missing | No refund on a question; no tool call on chit-chat |
| `reference` | Similar to a reference answer | Token F1, ROUGE, embedding cosine: a screen for big drops, never a gate on its own |
| `judge` | A rubric criterion holds | Binary criteria, calibrated (below) |
| `pairwise` | Candidate preferred over baseline | Both orders; ties allowed |
| `cost` / `latency` | Under a budget | Per case and p95 across the run |

A case passes when all its assertions hold. Report the failing assertion's message, not just
"failed".

## LLM-as-judge

- **Rubric:** a few binary criteria ("states the refund amount", "does not promise a date",
  "answers in the customer's language"), each with a pass and a fail example. Scales of 1-10
  tend to cluster and drift; binary criteria are easier to calibrate and for annotators to agree on.
- **Inputs:** the case input, the output, the reference or retrieved context when the criterion
  needs it. Ask for the reason before the verdict, and parse the verdict with a schema.
- **Calibration:** label 50-100 outputs by hand (include failures), run the judge, and compute
  agreement and Cohen's kappa per criterion. Under about 0.6, rewrite the criterion or replace
  it with a deterministic check. Keep the labeled set as the judge's own regression suite.
- **Pin and recalibrate:** the judge model, prompt and temperature are part of the baseline.
  Changing any of them changes every score; recalibrate before comparing.
- **Biases to control:** position (in pairwise, run both orders and count a win only when both
  agree), verbosity (longer answers win; add a length criterion or penalty), self-preference (a
  model rating its own family's outputs; use a different judge or check agreement on a mixed
  set).
- **Cost:** a judge call per criterion per sample adds up; judge only cases where deterministic
  assertions passed.

## Baseline and flip report

Store per case: dataset version, prompt version or hash, model id, parameters, seed, samples,
outputs, per-assertion results, tokens, cost, latency. Compare a candidate on the same dataset
version:

```text
baseline   16/20 (80.0%, 95% CI 58.4-91.9%)
candidate  16/20 (80.0%, 95% CI 58.4-91.9%)

PASS -> FAIL  billing-double-charge-pw  category: expected "billing", got "account"
PASS -> FAIL  billing-refund-login-email  category: expected "billing", got "account"; refundCents: expected 1999 +/- 0, got undefined
FAIL -> PASS  account-reset-error  now passes
FAIL -> PASS  account-2fa-500  now passes

flips: 2 regressed, 2 fixed, exact McNemar p=1.000
stable failures: bug-sarcastic-paying, injection-ignore-instructions
gate: FAIL - billing-double-charge-pw regressed and is not in acceptedRegressions; ...
```

That is the output of `node examples/llm/eval.mjs --baseline baseline --candidate regressed` in
this repository: same aggregate, four flips, a failed gate.

Gate rules that work:

- Any unreviewed `PASS -> FAIL` fails. Reviewed ones go in an accepted list with a reason and a
  reviewer; the list resets when the baseline is promoted.
- Any failure in a `critical` or `safety` slice fails, even if it failed before.
- Budgets: cost per case, p95 latency, steps per task against the baseline.
- Promote the candidate's results to baseline only after merge, never to make a gate pass.

## Statistics

- **Intervals:** report pass rates with a Wilson 95% interval. 16/20 is 58-92%; 160/200 is
  about 74-85%; 800/1,000 is about 77-82%.
- **Paired comparison:** both versions run the same cases, so compare per case. Only discordant
  cases (flips) carry information; the exact McNemar test on regressions versus fixes says
  whether the imbalance is more than chance. 0 regressions and 6 fixes is p=0.031; 0 and 4 is
  p=0.125.
- **Unpaired sample size** for a drop from 80% at 80% power and alpha 0.05: about 1,100 cases
  per arm for 5 points, about 290 for 10 points. Online A/B comparisons are unpaired.
- **Samples per case:** at temperature above 0, or when a provider is not deterministic at 0,
  draw k samples and pass on a declared rule: majority for classification, all k (pass^k) for
  actions with side effects, any of k (pass@k) only when a verifier picks the answer in
  production. Report the per-case pass fraction, not just the verdict.
- **Noise floor:** run the baseline against itself with a different seed and count flips. In
  this repository's stub at temperature 0.6, single samples flipped 1-4 of 20 cases on each of 8
  seeds; a majority over 25 samples flipped none.
- **Multiple slices:** with many slices, some will move by chance. Gate on pre-declared critical
  slices; treat other slice moves as leads.

## Harness options

A small harness of your own is often enough: load cases, call the feature through its real
entry point, run assertions, write per-case results as JSON, compare with the stored baseline,
print flips, exit non-zero on a failed gate. Frameworks that do this with more reporting:
promptfoo, Braintrust, LangSmith, provider-published eval frameworks, DeepEval, Ragas (RAG
metrics) and Inspect (agent and task evals). Check before adopting one that it keeps per-case results across runs and can
fail a pipeline on case-level rules.
