# Launch notes

What to post, where, and the claims each post can back with something a reader can rerun.

## Positioning

- One line: **Tests that can fail.** Agent Skills that catch fake and weakened tests, and let
  Bombadil find the bugs nobody scripted.
- The enemy is the green suite that proves nothing, not testing frameworks or other skills.
- Every claim links to a command in this repository that reproduces it.

## Claims and their evidence

| Claim                                                                                                               | Reproduce                                                                               |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Bombadil finds the seeded bugs in a demo store with no scripted paths, and stays silent when fixed                  | `pnpm demo`, `pnpm demo:fixed`, `scripts/verify-demo.sh` (CI)                           |
| It found a bug nobody planted (safe-integer overflow)                                                               | `examples/buggy-shop/README.md`, `qty-overflow`                                         |
| The guard catches deleted, skipped and bent tests                                                                   | `node skills/test-guard/scripts/guard-tests.mjs` in a repository after weakening a test |
| The audit has no false positives on a 199-file production suite                                                     | Run `audit-tests.mjs` on any well-maintained suite and compare                          |
| On small fixtures a frontier model already writes strong tests; the skills add measured evidence, not higher scores | `evals/results/2026-10-12-agent-tests.md`                                               |
| First Agent Skills for Bombadil                                                                                     | No other Bombadil skill or server found on skills.sh or GitHub at launch                |

## Channels

1. **Show HN.** Title: "Show HN: Agent skills that catch fake tests and let Bombadil find unscripted bugs".
   First comment: the problem in three lines, the demo table, the guard output, the eval table,
   and what it does not do.
2. **X / Bluesky thread.** Post 1: the guard output on an agent-weakened test. Post 2: the demo
   table. Post 3: "it found a bug we did not plant". Post 4: the honest eval (no score gain on easy fixtures, more evidence). Post 5: install
   line. Mention the Bombadil maintainers and Antithesis; the repository is the first set of
   agent skills for their tool and links back to it.
3. **skills.sh.** Installs drive the leaderboard; ask early users to install with `npx skills add`.
4. **Plugin marketplace.** Submit the `.claude-plugin/` manifest to the official marketplace.
5. **Bombadil community.** Offer the runner, page kit and gotchas upstream as examples or docs.

## Before posting

- CI green on the default branch, including the demo job.
- The repository is public and the default branch carries the release.
- A short screen recording of `pnpm demo` (terminal plus `bombadil browser inspect`).
- Eval results committed with the exact prompts and commands used.
