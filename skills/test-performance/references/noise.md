# Noise control

Every timing has noise from the machine. A timing check is only as good as its margin over that
noise, measured on the runner that enforces it. Reduce the noise, compare against the same
machine, and measure the false-failure rate before gating.

## Sources

| Source | Effect | Control |
| --- | --- | --- |
| Other processes and noisy neighbors (shared CI, cloud VMs) | Preemption mid-sample; bursts of 2x or more | Dedicated or bare-metal runner; no parallel jobs; many short samples |
| CPU frequency scaling and turbo | Speed depends on temperature and recent load | Performance governor, turbo off, or measure ratios in one process |
| Runner hardware differences | Absolute times differ across machines | Same runner type for baseline and head; never compare across types |
| JIT warm-up, tiered compilation | First iterations slower | Warm-up iterations; separate cold-start benchmarks |
| Garbage collection | Pauses land on random samples | Many samples; minimum or median; report allocations separately |
| Caches (CPU, disk, connection pools) | First run cold, later runs warm | Decide cold or warm and control it explicitly |
| Timer resolution | Sub-microsecond operations unmeasurable | Repeat the operation inside a sample until it takes 0.2 ms or more |
| Address-space layout and code alignment | Run-to-run shifts of a few percent | Several process launches (JMH forks); treat small deltas as noise |

## Comparison designs, from most to least robust

1. **Count instead of time.** Queries, calls, allocations, instructions (Cachegrind-based
   harnesses). Deterministic or nearly so; gate on every change.
2. **Ratio in one process.** Same operation at n and 8n, interleaved, fastest of many samples.
   Machine speed cancels. See [counting.md](counting.md).
3. **Base and head in one job.** Build both, run them alternately (A B A B) on the same machine
   with many samples each, compare with a statistical test and a minimum effect size.
4. **Head against a stored baseline from the same runner type.** Drift in the runner fleet
   shows up as regressions; refresh the baseline from main and keep the history.
5. **Absolute threshold.** Only for SLOs measured under load, or for budgets with a large margin
   over the measured distribution on a dedicated runner.

## Measured in this skill's source repository

On a shared 4-core Linux machine with Node 22:

- Ratio of fastest samples (n = 200 and 8n, 15 interleaved samples of at least 0.2 ms): 0 of 120
  rounds misclassified per variant with six copies competing for the CPU. Ratio of medians of the
  same samples: the linear version misclassified as quadratic in 40 of 120.
- The fastest of 7 samples of 0.5 ms or more misclassified 1 of 60 contended rounds; shorter,
  more numerous samples removed it.
- Time per call at n = 200 varied up to 2.5x (median sample) and 1.85x (fastest sample) across
  rounds of one contended process, and up to 1.5x (fastest sample) on a quiet machine, while the
  ratio of fastest samples stayed on the right side of its threshold every time.
- Vitest bench with a stored baseline, mean latency, `delta` 0.1, unchanged code: 8 of 20 runs
  reported a regression (up to 28% "slower"), while the fastest sample moved under 2%.

Variance across machines and runner types was not measured.

## Before a timing check gates anything

- Run it 20 times on the enforcing runner with no code change, alone and with parallel copies
  (`test-flaky`'s repeat script with `--parallel`), and record the false-failure rate.
- Gate only when that rate is zero over the runs and the seeded regression still fails with
  margin; otherwise make it a warning or a scheduled measurement.
- Record the runner, the sample counts and the threshold derivation next to the check.
- When it fails, rerun base and head in one job before calling it a regression. A regression
  that does not reproduce in a same-job comparison is noise. Measure it; do not retry it away.
