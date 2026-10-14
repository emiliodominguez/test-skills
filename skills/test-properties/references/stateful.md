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

```python
class CacheMachine(RuleBasedStateMachine):
    def __init__(self):
        super().__init__()
        self.real, self.model = create_lru(2), []

    @rule(key=st.sampled_from("abc"), value=st.integers(0, 9))
    def put(self, key, value): ...

    @rule(key=st.sampled_from("abc"))
    def get(self, key):
        assert self.real.get(key) == model_get(self.model, key)

TestCache = CacheMachine.TestCase
```

In this repository's examples, a cache whose reads do not refresh recency passes example tests
of set and get, and the model-based property shrinks it to a sequence of five commands or fewer.

## Keys and values

Use a tiny key space (three keys, not arbitrary strings) so commands collide: eviction, overwrite
and delete-then-read bugs need the same key twice. Use small values so shrunk reports read
easily.

## Preconditions and references

- Commands valid only in some states declare it (`check(model)`, Hypothesis `@precondition`).
- Commands that create things later commands act on keep references in the model (Hypothesis
  `Bundle`; in fast-check, store created ids in the model and pick by index at run time).

## Asynchronous systems and races

- fast-check `asyncModelRun` for async APIs; `fc.scheduler()` to control the order in which
  awaited promises resolve, so races (two saves, a stale response arriving last) are explored and
  shrunk deterministically.
- Linearizability: run commands from two simulated clients concurrently and check the result is
  explainable by some sequential order of the model (fast-check scheduler, Hypothesis with
  explicit interleavings, Jepsen-style checkers for distributed stores).

## Scope

Test the state machine where it lives (a store, a reducer, a service with in-memory adapters),
not through the interface; the interface layer gets the same idea through `test-explore`.
