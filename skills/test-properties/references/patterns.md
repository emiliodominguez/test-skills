# Property patterns

Each shape in fast-check (JavaScript, TypeScript) and Hypothesis (Python). Other libraries use
the same structure with different names.

## Invariant

A fact about the output that holds for every input.

```ts
fc.assert(
	fc.property(fc.nat({ max: 1_000_000 }), fc.integer({ min: 1, max: 50 }), function keepsEveryCent(cents, parts) {
		const shares = allocate(cents, parts);

		return sum(shares) === cents && Math.max(...shares) - Math.min(...shares) <= 1;
	}),
);
```

```python
@given(st.integers(0, 1_000_000), st.integers(1, 50))
def test_allocation_keeps_every_cent(cents, parts):
    shares = allocate(cents, parts)
    assert sum(shares) == cents and max(shares) - min(shares) <= 1
```

Typical invariants: totals equal the sum of lines; output is sorted and a permutation of the
input; a balance never goes negative; every id in the output exists in the input; lengths and
counts are conserved; a result stays within its declared bounds.

## Round trip

Two functions that undo each other: encode/decode, serialize/parse, format/parse, compress,
encrypt, save/load. Generate the structured side, not the text side, so every generated value is
valid.

```ts
fc.assert(
	fc.property(fc.array(fc.array(fc.string(), { minLength: 1 }), { minLength: 1 }), function survivesRoundTrip(rows) {
		expect(decodeCsv(encodeCsv(rows))).toEqual(rows);
	}),
);
```

When the trip is lossy by design (a date formatted to minutes), compare after normalizing both
sides the same way, and state the loss in the property's name.

## Oracle and differential

The optimized implementation equals a slow, obviously correct one; the new version equals the old
one on inputs where behavior must not change; two libraries agree on a standard (two JSON
parsers, two URL parsers). A disagreement is a bug in one of them: triage before assuming which.

```python
@given(st.lists(st.integers()))
def test_fast_sort_matches_sorted(values):
    assert fast_sort(values) == sorted(values)
```

## Metamorphic relations

When nobody knows the expected output (search ranking, pricing with many rules, numerical code,
ML scoring), relate two runs instead:

| Change the input | The output must |
| --- | --- |
| Add an item to a cart | Not decrease the total |
| Tighten a search filter | Return a subset of the previous results |
| Permute input records | Produce the same aggregate |
| Scale every price by k | Scale the subtotal by k (before rounding) |
| Add a duplicate event | Leave an idempotent consumer's state unchanged |
| Translate a shape | Keep its area |

```ts
fc.assert(
	fc.property(fc.array(fc.nat({ max: 30_000 }), { maxLength: 5 }), fc.nat({ max: 30_000 }), function neverLower(lines, extra) {
		return discountedTotal([...lines, extra]) >= discountedTotal(lines);
	}),
);
```

This one finds a tier threshold that makes customers pay less after adding an item, with no
expected total written anywhere.

## Idempotence and commutativity

`f(f(x)) == f(x)` for normalizers, formatters, migrations, retries and upserts. For event
handling and synchronization, apply the same events in two generated orders and compare the
states: order-dependent merges and last-writer bugs show up as different states.

## Never crashes (robustness)

At a trust boundary, any input yields a value or a typed refusal, never an exception or a hang:

```python
@given(st.text())
def test_parse_never_raises(text):
    result = parse_amount(text)
    assert isinstance(result, (Amount, ParseError))
```

This is the weakest useful property: pair it with a round trip or an oracle on the valid subset.

## Finding properties

- Ask what a reviewer checks by eye on the output: sums, ordering, bounds, presence of ids.
- Look for inverse pairs and for a slow version that exists or is easy to write.
- Turn each example test into a question: what about this example holds for every input?
- When stuck, write "never crashes" first, then strengthen it with a relation.
