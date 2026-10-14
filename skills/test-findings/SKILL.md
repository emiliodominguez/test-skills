---
name: test-findings
description: "Triage of findings from exploration, fuzzing, fault injection or flaky tests: reproduce, confirm, shrink, classify and pin. Use when a property is violated or a run fails. Hands back to `test-explore` or `test-unit`."
metadata:
  stage: triage
---

# Findings

A finding is a claim until it reproduces. Turn each one into either a fixed bug with a
regression test or a corrected property, with the evidence that decided it.

## Process

1. **Collect the record.** The trace or log, screenshots, the violated property or failing test,
   and the full setup (seed, data set, locale, viewport, fault rules, versions). Without the
   setup, a replay is a new experiment.
2. **Reproduce on a fresh environment** with the same setup. For exploration, replay the
   recorded actions; for a test, rerun it in isolation and in its original order.
3. **Confirm.** Replay up to the last finding and record which findings happened again. A
   finding from an impatient or fault-injected run that does not recur is a lead about timing,
   not a fixed fact; say so.
4. **Shrink.** Minimize the steps that still reproduce it. See
   [references/shrinking.md](references/shrinking.md). A five-step reproduction is triaged in
   minutes; a nine-hundred-step trace is not.
5. **Classify** with file and line references:
   - **Bug in the app:** the property is right and the app broke it. Name the smallest fix.
   - **Wrong property:** a false positive (loading state judged, a race in the extractor, a
     renamed hook, a threshold below normal behavior). Name how to tighten it.
   - **Harness problem:** settling, ids, fences, watchdog, fixture. Fix the harness, not the app.
   - **Nondeterminism in a test:** shared state, clock, randomness, ordering, network,
     concurrency, cleanup. Fix the source; never add a blind retry (see `test-flaky`).
6. **Pin it.** A bug gets a deterministic regression test at the lowest layer that shows it
   (often a unit or flow test), shown failing before the fix. A corrected property gets a silent
   covering run on the fixed app.
7. **Record the decision** in the finding policy when it cannot be fixed now: a known finding
   with the property, the screen, the reason and an expiry date. Expired entries fail again.

## Delegating triage

A separate read-only agent session can draft the classification from a triage packet: the run
setup, the violation, the property's source and the last 25 steps. Redact the packet first:
replace the repository path and home directory, drop secrets and personal data from extracted
values. Ask for a verdict (bug or wrong property), file and line references, and the smallest fix
or the tightened property, in under 400 words, with no file changes. Treat the answer as a draft
to check against the replay, not as the verdict.

## Measurements are leads

Latency regressions, accessibility scan counts, call volume and memory growth are recorded, then
triaged in batches. A regression against a per-machine baseline is a lead to investigate, not a
failure to block on. Re-save a baseline only when the cause is understood.

## Anti-patterns

- Fixing the app from a finding that never reproduced.
- Widening a property until it stops failing without naming the false positive it had.
- Retrying until green, or quarantining without an owner and visible missing coverage.
- Known findings without an expiry date.
- Sending an unredacted trace to another service.

## Done when

- Each finding is classified with evidence: reproduced or not, confirmed or not, minimal steps.
- Bugs have a regression test shown failing before the fix; wrong properties are corrected and
  silent on a covering run.
- Unfixed findings are in the policy with a reason and expiry, or listed as open.

Hand back to `test-explore` to correct a property, or to `test-unit` to pin the bug.
