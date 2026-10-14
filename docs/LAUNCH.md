# Launch notes

What to post, where, and the claims each post can back with something a reader can rerun.

## Positioning

- One line: **Tests that can fail.** Agent Skills for every kind of testing, each with a seeded bug
  that proves the recommended test catches it, plus tools that catch fake and weakened tests.
- The enemy is the green suite that proves nothing, not testing frameworks or other skills.
- Every claim links to a command in this repository that reproduces it.

## Claims and their evidence

| Claim                                                                                                                                                 | Reproduce                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Bombadil finds the seeded bugs in a demo store with no scripted paths, and stays silent when fixed                                                    | `pnpm demo`, `pnpm demo:fixed`, `scripts/verify-demo.sh`, `pnpm verify`                  |
| It found a bug nobody planted (safe-integer overflow)                                                                                                 | `examples/buggy-shop/README.md`, `qty-overflow`                                          |
| The guard catches deleted, skipped and bent tests                                                                                                     | `node skills/test-guard/scripts/guard-tests.mjs` in a repository after weakening a test  |
| The audit reports no findings on a 199-file production suite it was not written for                                                                   | `node skills/test-audit/scripts/audit-tests.mjs <path to that suite>` (suite not public) |
| On small fixtures a frontier model already writes strong tests; on a 77-mutant module the skill arms closed the gaps plain arms left (100% vs 97-99%) | `evals/results/2026-10-12-agent-tests.md`                                                |
| First Agent Skills for Bombadil (as of 2026-10)                                                                                                       | Search skills.sh and GitHub for Bombadil skills; none found at the time of writing       |
| Exploration is tool-agnostic: Bombadil, fast-check and Hypothesis find the same seeded bugs                                                           | `pnpm demo`, `pnpm demo:fc`, `python -m pytest examples/buggy-shop/hypothesis -q`        |
| An accessibility scan alone misses keyboard bugs: axe reports zero violations on a page with nine                                                     | `node examples/accessibility/verify.mjs`                                                 |
| An eval average hides regressions: 80% before and after, two cases broken                                                                             | `npx vitest run test/llm-examples.test.ts`                                               |
| A mocked database passes bugs a real one catches                                                                                                      | `npx vitest run test/integration-examples.test.ts`                                       |
| Each property shape catches a bug its example test misses                                                                                             | `npx vitest run test/properties-examples.test.ts`                                        |

## Channels

1. **Show HN.** Title: "Show HN: Agent skills for every kind of testing, each proving its test can fail".
   First comment: the problem in three lines, the demo table, the guard output, the eval table,
   and what it does not do.
2. **X / Bluesky thread.** Post 1: the guard output on an agent-weakened test. Post 2: the demo
   table. Post 3: "it found a bug we did not plant". Post 4: the honest eval (no gain on easy fixtures, gaps closed on the harder one). Post 5: install
   line. Mention the Bombadil maintainers and Antithesis; the repository is the first set of
   agent skills for their tool and links back to it.
3. **skills.sh.** Installs drive the leaderboard; ask early users to install with `npx skills add`.
4. **Plugin marketplace.** Submit the `.claude-plugin/` manifest to the official marketplace.
5. **Bombadil community.** Offer the runner, page kit and gotchas upstream as examples or docs.

## Before posting

- `pnpm verify` green on the default branch, including the demo.
- The repository is public and the default branch carries the release.
- A short screen recording of `pnpm demo` (terminal plus `bombadil browser inspect`).
- Eval results committed with the exact prompts and commands used.
