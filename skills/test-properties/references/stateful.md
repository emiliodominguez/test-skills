# Stateful and model-based testing

Generate sequences of operations, run each against the real system and a model, and compare.
The model is a few lines of the most obvious code (an array, a map); the real system is the
cache, cart, editor, queue, API client or protocol under test.

## Structure

1. **Model:** the smallest state that predicts observable behavior.
2. **Commands:** one per operation, each with a precondition (`check`) saying when it is valid in
   the current model state, a `run` that applies it to both and compares, and a readable
   `toString` for reports.
3. **Comparison:** after every command, assert what a caller could observe (return values, sizes,
   visible items), not internal structure.

```ts
class Get implements fc.Command<Model, Cache> {
	constructor(readonly key: string) {}
	check(): boolean {
		return true;
	}
	run(model: Model, real: Cache): void {
		expect(real.get(this.key)).toBe(model.values.get(this.key));
		if (model.values.has(this.key)) model.touch(this.key); // a hit refreshes recency in the model too
	}
	toString(): string {
		return `get(${this.key})`;
	}
}

fc.assert(
	fc.property(fc.commands([setCommand, getCommand]), function agreesWithModel(cmds) {
		fc.modelRun(function setup() {
			return { model: emptyModel(), real: createLru(2) };
		}, cmds);
	}),
);
```

The Hypothesis version below runs as is given a `create_lru` factory whose cache has `get`, `put`
and `len`; the model is a list of `(key, value)` pairs, least recently used first:

```python
from hypothesis import strategies as st
from hypothesis.stateful import RuleBasedStateMachine, invariant, rule

CAPACITY = 2


def model_put(model, key, value):
    model = [entry for entry in model if entry[0] != key] + [(key, value)]
    return model[-CAPACITY:]


def model_get(model, key):
    for entry in model:
        if entry[0] == key:  # a hit moves the entry to most recent
            return entry[1], [other for other in model if other[0] != key] + [entry]
    return None, model


class CacheMachine(RuleBasedStateMachine):
    def __init__(self):
        super().__init__()
        self.real, self.model = create_lru(CAPACITY), []

    @rule(key=st.sampled_from("abc"), value=st.integers(0, 9))
    def put(self, key, value):
        self.real.put(key, value)
        self.model = model_put(self.model, key, value)

    @rule(key=st.sampled_from("abc"))
    def get(self, key):
        expected, self.model = model_get(self.model, key)
        assert self.real.get(key) == expected

    @invariant()
    def same_size(self):
        assert len(self.real) == len(self.model)


TestCache = CacheMachine.TestCase
```

With Hypothesis 6.169 and a cache whose reads do not refresh recency, this failed with five
rules (`put a`, `put c`, `get a`, `put b`, `get a`) and passed on the fixed cache.

In the test-skills repository (`test/properties-examples.test.ts`, which holds the complete
fast-check version of the excerpt above), a cache whose reads do not refresh recency passes
example tests of set and get, and the model-based property shrinks it to a sequence of five
commands or fewer.

## Keys and values

Use a tiny key space (three keys, not arbitrary strings) so commands collide: eviction, overwrite
and delete-then-read bugs need the same key twice. Use small values so shrunk reports read
easily.

## Preconditions and references

- Commands valid only in some states declare it (`check(model)`, Hypothesis `@precondition`).
- Commands that create things later commands act on keep references in the model (Hypothesis
  `Bundle`; in fast-check, store created ids in the model and pick by index at run time).

## Asynchronous systems and races

- fast-check `fc.asyncModelRun` runs async commands one after another, awaiting each.
- `fc.scheduler()` generates a scheduler that decides the order in which wrapped promises
  resolve, so races (two saves, a stale response arriving last) are explored, shrunk and
  replayed from the seed. Wrap the mocked I/O with `s.scheduleFunction`, start the calls, then
  release everything with `await s.waitIdle()` and assert. The failure report prints the
  resolution order.

  ```ts
  test("the latest query wins", async function latestQueryWins() {
  	await fc.assert(
  		fc.asyncProperty(fc.scheduler(), fc.array(fc.string(), { minLength: 1, maxLength: 4 }), async function latestWins(s, queries) {
  			const api = s.scheduleFunction(async function fetchResults(query: string) {
  				return [query];
  			});
  			const store = createSearchStore(api);

  			for (const query of queries) store.search(query);
  			await s.waitIdle();
  			expect(store.results).toEqual([queries.at(-1)]);
  		}),
  	);
  });
  ```

  `createSearchStore` is the store under test. With fast-check 4.10, a store that writes every
  response as it arrives failed this on 20 of 20 seeds, each shrunk to two queries resolved in
  reverse order.
- `fc.scheduledModelRun(s, setup, cmds)` combines both: each command's `check` and `run` is
  itself a scheduled task, so command starts interleave with the I/O earlier commands started. A
  command's `run` must start its call without awaiting a scheduled promise: the scheduler waits
  for a running command before releasing other tasks, so awaiting one there never settles.
  `scheduledModelRun` resolves after every scheduled task has; compare the system with the model
  after it.
- Linearizability: run commands from two simulated clients concurrently and check the result is
  explainable by some sequential order of the model (fast-check scheduler, Hypothesis with
  explicit interleavings, Jepsen-style checkers for distributed stores).

## Scope

Test the state machine where it lives (a store, a reducer, a service with in-memory adapters),
not through the interface; the interface layer gets the same idea through `test-explore`.
