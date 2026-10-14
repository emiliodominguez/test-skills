// An invoice list that loads over HTTP, used as evidence by `test/component-examples.test.ts`.
//
// The shipped bug lives in the data hook: it never checks `response.ok`, so a 500 whose body has
// no `invoices` field renders the empty state ("No invoices yet") instead of an error. A test that
// replaces the hook with a canned state never runs that code; a test that fakes the network does.
import { createElement as h, useEffect, useState, type ReactElement } from "react";

/** One invoice row as the API returns it. */
export interface Invoice {
	id: string;
	totalCents: number;
}

/** Every state the list can be in. */
export type InvoicesState = { status: "loading" } | { status: "error" } | { status: "ready"; invoices: Invoice[] };

/** Text of the error state. */
export const LOAD_ERROR_MESSAGE = "Could not load invoices. Try again later.";

/** Text of the empty state. */
export const EMPTY_MESSAGE = "No invoices yet";

/**
 * Load invoices from the API.
 *
 * @param url - Absolute endpoint URL.
 * @param fixed - Check the HTTP status (the fix) instead of trusting any JSON body (the bug).
 * @returns The current loading state.
 */
export function useInvoices(url: string, fixed: boolean): InvoicesState {
	const [state, setState] = useState<InvoicesState>({ status: "loading" });

	useEffect(
		function load() {
			let active = true;

			/**
			 * Fetch and decode the invoices, then publish the result unless the component unmounted.
			 */
			async function run(): Promise<void> {
				try {
					const response = await fetch(url);

					if (fixed && !response.ok) throw new Error(`GET ${url} answered ${response.status}`);

					const body = (await response.json()) as { invoices?: Invoice[] };

					if (active) setState({ status: "ready", invoices: body.invoices ?? [] });
				} catch {
					if (active) setState({ status: "error" });
				}
			}

			void run();

			return function cancel() {
				active = false;
			};
		},
		[url, fixed],
	);

	return state;
}

/**
 * Format cents as US dollars.
 *
 * @param cents - Amount in cents.
 * @returns The formatted amount.
 */
function formatCents(cents: number): string {
	return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

/**
 * Presentational list: renders whatever state it is given.
 *
 * @param props - The loading state.
 * @returns Loading, error, empty or populated markup.
 */
export function InvoiceListView(props: { state: InvoicesState }): ReactElement {
	const { state } = props;

	if (state.status === "loading") return h("p", { role: "status" }, "Loading invoices...");
	if (state.status === "error") return h("p", { role: "alert" }, LOAD_ERROR_MESSAGE);
	if (state.invoices.length === 0) return h("p", null, EMPTY_MESSAGE);

	return h(
		"ul",
		{ "aria-label": "Invoices" },
		...state.invoices.map(function row(invoice) {
			return h("li", { key: invoice.id }, `${invoice.id} ${formatCents(invoice.totalCents)}`);
		}),
	);
}

/**
 * The connected list: the data hook plus the view.
 *
 * @param props - Endpoint and variant switch.
 * @returns The list for the current state.
 */
export function InvoiceList(props: { url: string; fixed?: boolean }): ReactElement {
	return h(InvoiceListView, { state: useInvoices(props.url, props.fixed === true) });
}
