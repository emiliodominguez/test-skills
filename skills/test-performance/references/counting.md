# Counting operations and scaling ratios

A count is the cheapest performance check that never flakes. Count at a boundary the code
already crosses, assert at two input sizes, and the budget states the complexity.

## Where to count

| Boundary | How to observe it |
| --- | --- |
| SQL, Django | `assertNumQueries(n)` in `TestCase`; pytest-django `django_assert_num_queries` fixture |
| SQL, Rails | `assert_queries_count(n)` (Active Record 7.2+); Bullet with `Bullet.raise = true` in tests to fail on N+1 and unused eager loads |
| SQL, SQLAlchemy | `event.listen(engine, "before_cursor_execute", counter)` |
| SQL, Hibernate / JPA | `hibernate.generate_statistics=true`, then `Statistics#getPrepareStatementCount()` |
| SQL, EF Core | A `DbCommandInterceptor` that counts executed commands |
| SQL, Laravel | `DB::listen` counter; `Model::preventLazyLoading()` in tests |
| SQL, Node ORMs and drivers | Query log events (Prisma `$on("query")` with query logging, Knex `on("query")`), or wrap the driver's `query` |
| HTTP from the code under test | Fake server event hooks (MSW `server.events.on("request:start", ...)`), an interceptor, or a counting fake client |
| HTTP from a page | Browser driver request events (`page.on("request", ...)`), grouped by route |
| Renders | React `<Profiler onRender>`, Vue devtools hooks, or a render counter in the component under test |
| Allocations | Go `testing.AllocsPerRun`; BenchmarkDotNet `[MemoryDiagnoser]`; JMH `-prof gc` |
| Algorithmic work | An injected comparator, key function, hasher or fetcher that counts its calls |
| Cache behavior | Hit and miss counters exposed by the cache, asserted after a warm pass |

Prefer the framework's counter to a mock of the data layer: the query count is a property of the
real ORM call pattern, which a mock replaces.

## Budgets that state growth

```ts
test("loading summaries costs two queries however many orders", async function queryBudget() {
	for (const orderCount of [3, 30]) {
		const counting = createCountingStore(orderCount);

		await loadOrderSummaries(counting.store, "acct-1");

		expect(counting.queries()).toBe(2);
	}
});
```

- Constant budgets (N+1, chatty clients): assert the same count at a small and a large size.
- Linear budgets (dedupe, indexing): assert `calls <= k * n` at two sizes; a quadratic
  implementation exceeds any constant k once n is large enough, and n = 100 already gives 50x.
- Use the exact current count when it is stable, and ratchet down on improvement. A raised count
  is a reviewed decision, not a test update.
- Include a functional assertion in the same suite, so the budget cannot pass by doing less work.

## Scaling ratio when only time shows the cost

When no boundary exposes the work (a regex, a tight loop, native code), time the same operation
at n and at factor * n, in the same process, and assert the ratio:

| Complexity | Ratio at 8n / n | Ratio at 4n / n |
| --- | --- | --- |
| O(1) | about 1 | about 1 |
| O(n) | about 8 | about 4 |
| O(n log n) | about 9-11 | about 4.5-5 |
| O(n²) | about 64 | about 16 |

Put the threshold near the geometric middle of the two classes to separate (24 between linear
and quadratic at 8n), so noise must move the ratio more than twofold to flip the verdict.

Procedure (as implemented in `examples/performance/scaling.mjs` in this skill's source repository):

1. Build both inputs before timing. Inputs must have the shape that triggers the worst case
   (distinct keys for a dedupe, adversarial strings for a regex).
2. Warm up both sizes a few times so the JIT has compiled the code.
3. Calibrate repetitions per sample on the small input until a sample takes at least 0.2 ms, and
   use the same repetitions for the large input.
4. Interleave small and large samples, 15 or more each.
5. Divide the fastest large sample by the fastest small sample. Noise only adds time, so the
   minimum is the least disturbed estimate. A ratio of medians failed 40 of 120 contended rounds
   on a linear function where the minimum failed none.
6. Keep the slow variant's large sample under about 50 ms so the test stays fast; lower n rather
   than the sample count.

Larger sizes stop fitting in cache and add a memory-hierarchy step to the ratio; keep both
inputs in the same cache regime, or widen the threshold and say why.

## Pitfalls

- Garbage collection lands on whichever sample allocates past the threshold; many short samples
  plus the minimum absorb it.
- Lazy initialization inside the first call: warm up, or the small size pays it.
- Results discarded by the compiler: consume the result (count it, sum a field).
- Inputs built inside the timed region: the ratio measures the builder.
