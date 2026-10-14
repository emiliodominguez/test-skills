// Evidence for the property shapes `test-properties` teaches: each example module has a bug that a
// typical example test misses; the property catches it with a small shrunk counterexample, and
// passes on the fixed version.
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { allocate, createLru, decodeCsv, discountedTotal, encodeCsv, fastSort } from "../examples/properties/modules.mjs";

type Options = { fixed?: boolean };

/**
 * Run a property against the buggy and the fixed module.
 *
 * @param build - Builds the property for one variant.
 * @returns The failing run on the buggy variant; the fixed variant must pass.
 */
function bugCaughtFixPasses<T>(build: (options: Options) => fc.IPropertyWithHooks<[T]> | fc.IAsyncPropertyWithHooks<[T]> | fc.IProperty<[T]>) {
	const buggy = fc.check(build({}) as fc.IProperty<[T]>, { seed: 42, numRuns: 1000 });

	fc.assert(build({ fixed: true }) as fc.IProperty<[T]>, { seed: 42, numRuns: 1000 });

	expect(buggy.failed).toBe(true);

	return buggy;
}

describe("invariant: allocation keeps every cent", function invariantSuite() {
	test("an example test passes on the bug", function example() {
		expect(allocate(100, 4)).toEqual([25, 25, 25, 25]);
	});

	test("the invariant catches it and shrinks to a tiny case", function invariant() {
		const run = bugCaughtFixPasses(function build(options: Options) {
			return fc.property(fc.tuple(fc.nat({ max: 1_000_000 }), fc.integer({ min: 1, max: 50 })), function keepsEveryCent([cents, parts]) {
				const shares = allocate(cents, parts, options);
				const sum = shares.reduce(function add(acc, share) {
					return acc + share;
				}, 0);

				return sum === cents && Math.max(...shares) - Math.min(...shares) <= 1;
			});
		});
		const [[cents, parts]] = run.counterexample as [[number, number]];

		expect(cents + parts).toBeLessThanOrEqual(5);
	});
});

describe("round trip: CSV decode after encode", function roundTripSuite() {
	test("an example test passes on the bug", function example() {
		expect(decodeCsv(encodeCsv([["a", "b,c"]]))).toEqual([["a", "b,c"]]);
	});

	test("the round trip catches unescaped quotes", function roundTrip() {
		const rows = fc.array(fc.array(fc.string({ unit: fc.constantFrom("a", ",", '"', "\n", " ") }), { minLength: 1, maxLength: 4 }), {
			minLength: 1,
			maxLength: 4,
		});
		const run = bugCaughtFixPasses(function build(options: Options) {
			return fc.property(rows, function survivesRoundTrip(value) {
				expect(decodeCsv(encodeCsv(value, options))).toEqual(value);
			});
		});
		const [failing] = run.counterexample as [string[][]];

		expect(failing.flat().join("")).toContain('"');
		expect(failing.flat().join("").length).toBeLessThanOrEqual(3);
	});
});

describe("model-based: an LRU cache against a list model", function modelSuite() {
	type Model = { keys: string[]; values: Map<string, number> };
	type Real = ReturnType<typeof createLru>;

	const CAPACITY = 2;

	/**
	 * A copy of the keys without one key.
	 *
	 * @param keys - Keys in recency order.
	 * @param key - Key to drop.
	 * @returns The remaining keys.
	 */
	function without(keys: string[], key: string): string[] {
		return keys.filter(function other(candidate) {
			return candidate !== key;
		});
	}

	/**
	 * Store a key in the cache.
	 */
	class SetCommand implements fc.Command<Model, Real> {
		constructor(
			readonly key: string,
			readonly value: number,
		) {}

		check(): boolean {
			return true;
		}

		run(model: Model, real: Real): void {
			real.set(this.key, this.value);
			model.keys = [...without(model.keys, this.key), this.key];
			model.values.set(this.key, this.value);
			if (model.keys.length > CAPACITY) model.values.delete(model.keys.shift() as string);
			expect(real.size()).toBe(model.keys.length);
		}

		toString(): string {
			return `set(${this.key}, ${this.value})`;
		}
	}

	/**
	 * Read a key; the cache must agree with the model, and a hit refreshes recency in both.
	 */
	class GetCommand implements fc.Command<Model, Real> {
		constructor(readonly key: string) {}

		check(): boolean {
			return true;
		}

		run(model: Model, real: Real): void {
			expect(real.get(this.key)).toBe(model.values.get(this.key));
			if (model.values.has(this.key)) {
				model.keys = [...without(model.keys, this.key), this.key];
			}
		}

		toString(): string {
			return `get(${this.key})`;
		}
	}

	test("example tests of set and get pass on the bug", function example() {
		const cache = createLru(CAPACITY);

		cache.set("a", 1);
		cache.set("b", 2);
		expect(cache.get("a")).toBe(1);
		expect(cache.get("b")).toBe(2);
	});

	test("random command sequences catch the missing recency refresh", function modelBased() {
		const key = fc.constantFrom("a", "b", "c");
		const commands = fc.commands([
			fc.tuple(key, fc.nat({ max: 9 })).map(function toSet([k, v]) {
				return new SetCommand(k, v);
			}),
			key.map(function toGet(k) {
				return new GetCommand(k);
			}),
		]);
		const run = bugCaughtFixPasses(function build(options: Options) {
			return fc.property(commands, function agreesWithModel(cmds) {
				fc.modelRun(function setup() {
					return { model: { keys: [], values: new Map() }, real: createLru(CAPACITY, options) };
				}, cmds);
			});
		});
		const steps = String(run.counterexample?.[0]).split(/,(?![^(]*\))/u);

		expect(steps.length).toBeLessThanOrEqual(5);
	});
});

describe("metamorphic: adding an item never lowers the total", function metamorphicSuite() {
	test("an example test of each tier passes on the bug", function example() {
		expect(discountedTotal([5_000])).toBe(5_000);
		expect(discountedTotal([20_000])).toBe(18_000);
	});

	test("the relation catches the threshold cliff without knowing any expected total", function metamorphic() {
		const lines = fc.array(fc.nat({ max: 30_000 }), { maxLength: 5 });

		bugCaughtFixPasses(function build(options: Options) {
			return fc.property(fc.tuple(lines, fc.nat({ max: 30_000 })), function neverLower([current, extra]) {
				return discountedTotal([...current, extra], options) >= discountedTotal(current, options);
			});
		});
	});
});

describe("oracle: the fast sort agrees with the obviously correct one", function oracleSuite() {
	test("an example test on nearly sorted input passes on the bug", function example() {
		expect(fastSort([1, 3, 2, 4])).toEqual([1, 2, 3, 4]);
	});

	test("the oracle catches it with a two-element counterexample", function oracle() {
		const run = bugCaughtFixPasses(function build(options: Options) {
			return fc.property(fc.array(fc.integer()), function matchesOracle(values) {
				expect(fastSort(values, options)).toEqual(
					[...values].sort(function ascending(a, b) {
						return a - b;
					}),
				);
			});
		});
		const [failing] = run.counterexample as [number[]];

		expect(failing).toHaveLength(2);
	});
});
