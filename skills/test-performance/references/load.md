# Load and stress tests

A load test answers one question about a deployed system: at this arrival rate, with this data,
does it meet its SLO? Write the question first ("checkout p99 under 800 ms and errors under 1% at
120 requests per second for 30 minutes"), then the script. None of these tools was run in this
repository; the content follows their documentation.

## Workload model

| Model | What is fixed | Use for | Tools |
| --- | --- | --- | --- |
| Open | Arrival rate: new requests start on schedule whether or not earlier ones finished | Public endpoints, APIs, anything with many independent users | k6 `constant-arrival-rate`, `ramping-arrival-rate`; Gatling `constantUsersPerSec`, `rampUsersPerSec`; Artillery `arrivalRate`; wrk2 |
| Closed | Concurrency: N users loop request, think time, request | Systems with a bounded user pool (call-center tools, batch workers) | k6 `constant-vus`, `ramping-vus`; Gatling `constantConcurrentUsers`; Locust users with `wait_time` |

**Coordinated omission.** In a closed model, when the system stalls, each virtual user waits and
sends fewer requests, so the stall is recorded once instead of for every request that real users
would have sent during it. Latency percentiles look healthy while users queue. Use an open model.
Check the tool reports dropped work (k6 `dropped_iterations` when the VU pool runs out). Record
latency in a histogram that keeps the tail (HdrHistogram-style), not averaged buckets.

## Test shapes

| Shape | Load | Duration | Finds | Cadence |
| --- | --- | --- | --- | --- |
| Smoke | 1-2 users or 1 rps | 1-2 min | Broken script, broken deploy | Every deploy |
| Load | Expected peak | 15-30 min | SLO misses at normal peak | Nightly or before release |
| Stress | Ramp past peak until the SLO breaks | Until the knee | Capacity, the first bottleneck, failure mode | Before capacity changes |
| Spike | Jump to 5-10x in seconds, then back | 10-20 min | Autoscaling lag, queue overflow, recovery | Before launches and campaigns |
| Soak | Expected load | 2-8 h or more | Leaks, pool exhaustion, log or disk growth, slow drift | Weekly or before release |

## k6 example

```js
// checkout.load.js, run with: k6 run -e BASE_URL=https://staging.example.test checkout.load.js
import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
	scenarios: {
		browse: {
			executor: "constant-arrival-rate",
			rate: 100,
			timeUnit: "1s",
			duration: "30m",
			preAllocatedVUs: 50,
			maxVUs: 400,
			exec: "browse",
		},
		checkout: {
			executor: "ramping-arrival-rate",
			startRate: 5,
			timeUnit: "1s",
			preAllocatedVUs: 20,
			maxVUs: 200,
			stages: [
				{ target: 20, duration: "5m" },
				{ target: 20, duration: "20m" },
				{ target: 0, duration: "5m" },
			],
			exec: "checkout",
		},
	},
	thresholds: {
		"http_req_failed": ["rate<0.01"],
		"http_req_duration{scenario:browse}": ["p(95)<300", "p(99)<800"],
		"http_req_duration{name:place-order}": [{ threshold: "p(99)<1500", abortOnFail: true, delayAbortEval: "1m" }],
		"dropped_iterations": ["count<1"],
		"checks": ["rate>0.99"],
	},
};

const BASE_URL = __ENV.BASE_URL;

/**
 * One anonymous product view.
 */
export function browse() {
	const response = http.get(`${BASE_URL}/products/${1 + Math.floor(Math.random() * 500)}`, { tags: { name: "product" } });

	check(response, {
		"product is 200": function isOk(r) {
			return r.status === 200;
		},
	});
}

/**
 * Add to cart and place an order, with think time between steps.
 */
export function checkout() {
	const cart = http.post(`${BASE_URL}/cart`, JSON.stringify({ sku: "sku-1", quantity: 1 }), {
		headers: { "Content-Type": "application/json" },
		tags: { name: "add-to-cart" },
	});

	sleep(1);

	const order = http.post(`${BASE_URL}/orders`, JSON.stringify({ cartId: cart.json("id") }), {
		headers: { "Content-Type": "application/json" },
		tags: { name: "place-order" },
	});

	check(order, {
		"order is 201": function isCreated(r) {
			return r.status === 201;
		},
	});
}
```

- Thresholds fail the run with a non-zero exit code; they are the SLO in code. `abortOnFail`
  stops a run that already lost, after `delayAbortEval` lets it warm up.
- Tag requests with a stable `name`, or URLs with ids explode the metric series.
- `dropped_iterations` above zero means the generator could not keep the rate: raise `maxVUs` or
  add generators, and do not trust the latencies of that run.
- Parameterize data from a file (`SharedArray`) so caches see a realistic key distribution, not
  one hot product.

## Other tools

- **Gatling** (Java, Kotlin, Scala): open and closed injection profiles; assertions on
  response-time percentiles and failed-request percentage fail the build.
- **Locust** (Python): closed model with `wait_time`; `constant_throughput` approximates a rate
  per user, and a `LoadTestShape` scripts ramps. It has no thresholds; fail CI from a `quitting`
  event listener that sets `environment.process_exit_code` from `environment.stats.total`
  (fail ratio, response-time percentiles).
- **Artillery** (YAML plus JavaScript): `phases` with `arrivalRate` and `rampTo` (open model);
  the `ensure` checks fail on p95, p99 or error-rate thresholds.

## Running it

- Target: a production-like environment with production-sized data and the same instance types,
  or production itself with an agreed window, traffic marking and a kill switch.
- Stub third-party services you do not own, or agree the load with them.
- Generator: separate machines from the system, CPU under about 70%, enough network; watch its
  own metrics, because a saturated generator reports the generator's latency.
- Correlate with server-side metrics (CPU, pool usage, queue depth, GC pauses, database waits)
  over the same window; the report names the first resource to saturate.
- Report p50, p95, p99, max, error rate, achieved versus target rate, and dropped iterations per
  scenario, against the SLO, with the model, shape, duration, environment and commit. Never the
  mean alone.
- Thresholds: the SLO. Without one, run the load shape 3-5 times on the target environment and
  set the threshold above the observed spread, then make someone own the SLO.
