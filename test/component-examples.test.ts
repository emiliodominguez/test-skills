// @vitest-environment jsdom
/// <reference lib="dom" />
// Evidence for the claims `test-component` makes. Each scenario runs against a buggy, a fixed and
// (for the coupon form) a harmlessly refactored component, and the outcomes are asserted for every
// variant: the recommended test fails on the bug and passes otherwise; the implementation-detail
// test misses the bug or breaks on the refactor.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import axe from "axe-core";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { createElement as h, type ReactElement } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi, type MockInstance } from "vitest";
import { CartItem, FaintNotice } from "../examples/component/cart-item.js";
import { CouponForm, CouponFormRefactored } from "../examples/component/coupon-form.js";
import { EMPTY_MESSAGE, InvoiceList, InvoiceListView, LOAD_ERROR_MESSAGE } from "../examples/component/invoice-list.js";

/** A scenario is one test body; it throws when the test would fail. */
interface Scenario {
	(): Promise<void>;
}

/** The callback a coupon form calls with the normalized code. */
interface ApplyCallback {
	(code: string): void;
}

/** Builds the coupon form variant under test around a callback. */
interface CouponMount {
	(onApply: ApplyCallback): ReactElement;
}

/** Builds a scenario for one coupon form variant. */
interface CouponBody {
	(mount: CouponMount): Scenario;
}

/**
 * Run a scenario as if it were a test, then unmount everything it rendered.
 *
 * @param scenario - The test body.
 * @returns "passes", or "fails: " plus the first line of the error.
 */
async function outcome(scenario: Scenario): Promise<string> {
	try {
		await scenario();

		return "passes";
	} catch (error) {
		return `fails: ${(error instanceof Error ? error.message : String(error)).split("\n")[0]}`;
	} finally {
		cleanup();
	}
}

/**
 * Collapse an outcome to its verdict, for comparing variants in one assertion.
 *
 * @param result - A value returned by {@link outcome}.
 * @returns "passes" or "fails".
 */
function verdict(result: string): string {
	return result.startsWith("fails") ? "fails" : "passes";
}

/**
 * The ids of the axe-core rules violated inside a rendered container (WCAG 2 A and AA rules).
 * Color contrast is off: jsdom has no layout or canvas, so axe can only mark it incomplete.
 *
 * @param container - Root of the rendered component.
 * @returns Violated rule ids.
 */
async function axeViolations(container: Element): Promise<string[]> {
	const results = await axe.run(container, {
		runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
		rules: { "color-contrast": { enabled: false } },
	});

	return results.violations.map(function toId(violation) {
		return violation.id;
	});
}

// Vitest runs this repository without globals, so React Testing Library cannot register its own
// hooks: it neither cleans up after each test nor turns the act environment on. Without this line
// React stays silent about updates outside act.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let consoleError: MockInstance;

beforeEach(function watchConsole() {
	consoleError = vi.spyOn(console, "error");
});

afterEach(function noActWarnings() {
	const actWarnings = consoleError.mock.calls.filter(function mentionsAct(call) {
		return String(call[0]).includes("act(");
	});

	consoleError.mockRestore();
	expect(actWarnings).toEqual([]);
});

describe("coupon form: role queries and user-event against test ids, CSS and fireEvent", function couponSuite() {
	const variants: Record<"buggy" | "fixed" | "refactored", CouponMount> = {
		buggy: function mountBuggy(onApply) {
			return h(CouponForm, { onApply });
		},
		fixed: function mountFixed(onApply) {
			return h(CouponForm, { onApply, fixed: true });
		},
		refactored: function mountRefactored(onApply) {
			return h(CouponFormRefactored, { onApply });
		},
	};

	/**
	 * Run one coupon test body against every variant.
	 *
	 * @param body - Builds the scenario for a variant.
	 * @returns The outcome per variant.
	 */
	async function acrossVariants(body: CouponBody): Promise<Record<keyof typeof variants, string>> {
		return {
			buggy: await outcome(body(variants.buggy)),
			fixed: await outcome(body(variants.fixed)),
			refactored: await outcome(body(variants.refactored)),
		};
	}

	/**
	 * Recommended: find the field and button by role and accessible name, act through user-event.
	 *
	 * @param mount - Variant under test.
	 * @returns The scenario.
	 */
	function byRoleWithUserEvent(mount: CouponMount): Scenario {
		return async function scenario() {
			const user = userEvent.setup();
			const onApply = vi.fn<ApplyCallback>();

			render(mount(onApply));
			await user.type(screen.getByRole("textbox", { name: "Coupon code" }), " save10 ");
			await user.click(screen.getByRole("button", { name: "Apply" }));

			expect(onApply).toHaveBeenCalledWith("SAVE10");
			expect(screen.getByRole("status").textContent).toBe("Coupon SAVE10 applied");
		};
	}

	/**
	 * Recommended: the keyboard path a person takes, typing the code and pressing Enter.
	 *
	 * @param mount - Variant under test.
	 * @returns The scenario.
	 */
	function byKeyboard(mount: CouponMount): Scenario {
		return async function scenario() {
			const user = userEvent.setup();
			const onApply = vi.fn<ApplyCallback>();

			render(mount(onApply));
			await user.type(screen.getByRole("textbox", { name: "Coupon code" }), "save10{Enter}");

			expect(onApply).toHaveBeenCalledWith("SAVE10");
		};
	}

	/**
	 * Implementation detail: a test id, fireEvent and a CSS class for the message.
	 *
	 * @param mount - Variant under test.
	 * @returns The scenario.
	 */
	function byTestIdWithFireEvent(mount: CouponMount): Scenario {
		return async function scenario() {
			const onApply = vi.fn<ApplyCallback>();
			const { container } = render(mount(onApply));

			fireEvent.change(screen.getByLabelText("Coupon code"), { target: { value: " save10 " } });
			fireEvent.click(screen.getByTestId("coupon-apply"));

			expect(onApply).toHaveBeenCalledWith("SAVE10");
			expect(container.querySelector(".coupon-form__message")?.textContent).toBe("Coupon SAVE10 applied");
		};
	}

	/**
	 * fireEvent's version of the keyboard path: a keydown on the field, which runs no default action.
	 *
	 * @param mount - Variant under test.
	 * @returns The scenario.
	 */
	function byFireEventKeyboard(mount: CouponMount): Scenario {
		return async function scenario() {
			const onApply = vi.fn<ApplyCallback>();

			render(mount(onApply));

			const field = screen.getByRole("textbox", { name: "Coupon code" });

			fireEvent.change(field, { target: { value: "save10" } });
			fireEvent.keyDown(field, { key: "Enter", code: "Enter" });

			expect(onApply).toHaveBeenCalledWith("SAVE10");
		};
	}

	test("role queries with user-event catch the mouse-only control and survive the refactor", async function recommended() {
		const results = await acrossVariants(byRoleWithUserEvent);

		expect(results.buggy).toMatch(/^fails: Unable to find an accessible element with the role "button" and name "Apply"/);
		expect(results.fixed).toBe("passes");
		expect(results.refactored).toBe("passes");
	});

	test("the keyboard path fails on the bug for the right reason", async function keyboard() {
		const results = await acrossVariants(byKeyboard);

		expect(results.buggy).toMatch(/^fails: expected "vi.fn\(\)" to be called with arguments/);
		expect(results.fixed).toBe("passes");
		expect(results.refactored).toBe("passes");
	});

	test("test ids with fireEvent pass on the bug and fail on the harmless refactor", async function implementationDetail() {
		const results = await acrossVariants(byTestIdWithFireEvent);

		expect(results.buggy).toBe("passes");
		expect(results.fixed).toBe("passes");
		expect(results.refactored).toMatch(/^fails: Unable to find an element by: \[data-testid="coupon-apply"\]/);
	});

	test("fireEvent cannot express the keyboard path: Enter submits nothing even on the fixed form", async function fireEventKeyboard() {
		const results = await acrossVariants(byFireEventKeyboard);

		expect([verdict(results.buggy), verdict(results.fixed), verdict(results.refactored)]).toEqual(["fails", "fails", "fails"]);
	});

	test("axe-core finds no violation in the mouse-only control", async function axeMissesIt() {
		const { container } = render(variants.buggy(vi.fn()));

		expect(await axeViolations(container)).toEqual([]);
	});
});

describe("cart item: axe-core inside a component test", function cartSuite() {
	/**
	 * Render a cart row inside a list and return its axe violations.
	 *
	 * @param fixed - Variant switch.
	 * @returns Violated rule ids.
	 */
	async function violationsFor(fixed: boolean): Promise<string[]> {
		const { container } = render(h("ul", null, h(CartItem, { name: "Coffee beans", onRemove: vi.fn(), fixed })));

		try {
			return await axeViolations(container);
		} finally {
			cleanup();
		}
	}

	test("an icon-only button without a name is reported; the labelled one is clean", async function buttonName() {
		expect(await violationsFor(false)).toEqual(["button-name"]);
		expect(await violationsFor(true)).toEqual([]);
	});

	test("the role query fails on the unnamed button too", async function roleQuery() {
		/**
		 * Remove the item through its named button.
		 *
		 * @param fixed - Variant switch.
		 * @returns The scenario.
		 */
		function removeByName(fixed: boolean): Scenario {
			return async function scenario() {
				const user = userEvent.setup();
				const onRemove = vi.fn();

				render(h("ul", null, h(CartItem, { name: "Coffee beans", onRemove, fixed })));
				await user.click(screen.getByRole("button", { name: "Remove Coffee beans" }));

				expect(onRemove).toHaveBeenCalledTimes(1);
			};
		}

		expect(verdict(await outcome(removeByName(false)))).toBe("fails");
		expect(await outcome(removeByName(true))).toBe("passes");
	});

	test("jsdom cannot judge color contrast: light gray on white is not a violation", async function contrast() {
		const { container } = render(h(FaintNotice));
		const results = await axe.run(container, { runOnly: { type: "rule", values: ["color-contrast"] } });

		expect(results.violations).toEqual([]);
		expect(
			results.incomplete.map(function toId(result) {
				return result.id;
			}),
		).toEqual(["color-contrast"]);
	});
});

describe("invoice list: fake the network, not the hook", function invoiceSuite() {
	const API = "https://api.example.test/invoices";
	const server = setupServer(
		http.get(API, function invoices() {
			return HttpResponse.json({
				invoices: [
					{ id: "INV-1", totalCents: 12000 },
					{ id: "INV-2", totalCents: 550 },
				],
			});
		}),
	);

	beforeAll(function listen() {
		server.listen({ onUnhandledFrame: "error" });
	});

	afterEach(function reset() {
		server.resetHandlers();
	});

	afterAll(function close() {
		server.close();
	});

	/**
	 * Make the endpoint answer 500 with a JSON error body.
	 */
	function failTheEndpoint(): void {
		server.use(
			http.get(API, function serverError() {
				return HttpResponse.json({ message: "database unavailable" }, { status: 500 });
			}),
		);
	}

	/**
	 * Happy path: loading first, then the rows, waited for with findBy and no sleep.
	 *
	 * @param fixed - Variant switch.
	 * @returns The scenario.
	 */
	function showsRows(fixed: boolean): Scenario {
		return async function scenario() {
			render(h(InvoiceList, { url: API, fixed }));

			expect(screen.getByRole("status").textContent).toBe("Loading invoices...");
			expect(screen.queryByRole("list", { name: "Invoices" })).toBeNull();

			const list = await screen.findByRole("list", { name: "Invoices" });
			const rows = within(list)
				.getAllByRole("listitem")
				.map(function text(row) {
					return row.textContent;
				});

			expect(rows).toEqual(["INV-1 $120.00", "INV-2 $5.50"]);
		};
	}

	/**
	 * Error path through the real hook: the network answers 500.
	 *
	 * @param fixed - Variant switch.
	 * @returns The scenario.
	 */
	function showsErrorFromNetwork(fixed: boolean): Scenario {
		return async function scenario() {
			failTheEndpoint();
			render(h(InvoiceList, { url: API, fixed }));

			expect((await screen.findByRole("alert")).textContent).toBe(LOAD_ERROR_MESSAGE);
		};
	}

	test("an unhandled request rejects instead of reaching the network", async function unhandled() {
		consoleError.mockImplementation(function silence() {});

		const failure = await fetch("https://api.example.test/unknown").then(
			function resolved(response) {
				return `resolved with ${response.status}`;
			},
			function rejected(reason: unknown) {
				return String((reason as { cause?: unknown }).cause);
			},
		);

		expect(failure).toContain('Cannot bypass a request when using the "error" strategy for the "onUnhandledFrame" option');
		expect(String(consoleError.mock.calls[0]?.[0])).toContain("intercepted a request without a matching request handler");
	});

	/**
	 * Render, wait with a sleep instead of findBy, and count React's act warnings.
	 *
	 * @param actEnvironment - Value of `IS_REACT_ACT_ENVIRONMENT` during the run.
	 * @returns The number of act warnings logged.
	 */
	async function actWarningsAfterSleep(actEnvironment: boolean): Promise<number> {
		const scope = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };

		scope.IS_REACT_ACT_ENVIRONMENT = actEnvironment;

		try {
			render(h(InvoiceList, { url: API, fixed: true }));
			// The anti-pattern under test: a fixed sleep standing in for "the rows rendered".
			await new Promise(function sleep(resolve) {
				setTimeout(resolve, 100);
			});
			expect(screen.getByRole("list", { name: "Invoices" })).toBeTruthy();

			return consoleError.mock.calls.filter(function mentionsAct(call) {
				return String(call[0]).includes("not wrapped in act(");
			}).length;
		} finally {
			scope.IS_REACT_ACT_ENVIRONMENT = true;
			cleanup();
			consoleError.mockClear();
		}
	}

	test("a sleep instead of findBy updates outside act; React warns only when the act environment is on", async function sleepWarns() {
		expect(await actWarningsAfterSleep(true)).toBe(1);
		expect(await actWarningsAfterSleep(false)).toBe(0);
	});

	test("the happy path passes on both variants, so it cannot see the bug", async function happyPath() {
		expect(await outcome(showsRows(false))).toBe("passes");
		expect(await outcome(showsRows(true))).toBe("passes");
	});

	test("a 500 from the faked network catches the bug inside the hook", async function networkBoundary() {
		expect(verdict(await outcome(showsErrorFromNetwork(false)))).toBe("fails");
		expect(await outcome(showsErrorFromNetwork(true))).toBe("passes");
	});

	test("what the buggy variant shows a person on a 500: the empty state", async function emptyInsteadOfError() {
		failTheEndpoint();
		render(h(InvoiceList, { url: API }));

		expect((await screen.findByText(EMPTY_MESSAGE)).tagName).toBe("P");
		expect(screen.queryByRole("alert")).toBeNull();
		cleanup();
	});

	test("replacing the hook with a canned error state passes while the bug ships", async function stubbedHook() {
		const result = await outcome(async function scenario() {
			render(h(InvoiceListView, { state: { status: "error" } }));

			expect(screen.getByRole("alert").textContent).toBe(LOAD_ERROR_MESSAGE);
		});

		expect(result).toBe("passes");
	});
});
