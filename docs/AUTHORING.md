# Authoring skills

A good skill contains the information that changes an agent's decisions, and nothing else.
Assume the agent can already code and already knows the testing framework basics.

## Description

Always loaded, and how the agent picks the skill. About 200-250 characters:

1. What the skill is, as a short noun phrase.
2. `Use when` plus the words a user would actually say ("flaky", "Bombadil violated", "E2E").
3. A handoff clause naming the next skills in backticks.

Do not summarize the procedure; an agent that reads the steps in the description may skip the body.

## Body

- **Outcome first:** one or two lines on what success looks like.
- **Process:** numbered steps with the decisions that matter: thresholds, budgets, stop conditions.
- **`## Anti-patterns`:** concrete failures the skill prevents.
- **`## Done when`:** observable results and the evidence needed to claim them.
- **Last line:** the next skill by backticked name.

Move material only some runs need into `references/<topic>.md`, one level deep, and say in the
body when to read it.

## Tools versus hosts

These are testing skills, so naming a testing tool is fine when the skill is about it (Bombadil,
axe-core). Stay neutral where any runner works: describe "the test runner", "a browser driver".
Never name an agent host or model, and never use invocation syntax such as `/name`.

## Sources

Distill from real, working test suites: patterns that survived contact with an application, the
gotchas that cost time, the thresholds that were measured. Strip project names, domain specifics
and private details. When a version-specific behavior is documented, say which version and put it
in a reference so it is easy to revisit on upgrade.

## Evaluate

- Before writing, run the task without the skill and note what goes wrong. No observed gap, no skill.
- Add 3-5 markers to `evals/beats.json`. They must appear in `SKILL.md`; they catch accidental
  wording loss, not behavior.
- Add four should prompts and three near misses to `evals/triggers.json`.
- Try the skill in a fresh agent session on a real project, and record what you checked.
