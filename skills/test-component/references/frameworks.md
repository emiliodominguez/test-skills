# Frameworks and environments

The practices are the same everywhere: render with real providers, query by role, act through
user events, fake the network. What changes is the render call, how providers attach and what
the environment can simulate.

## Environments

| Environment | Real layout and CSS | Real input events | Speed | Choose it for |
| --- | --- | --- | --- | --- |
| jsdom | No | Simulated | Fast | The default for behavior, forms, states, ARIA |
| happy-dom | No | Simulated | Faster | Large suites that do not touch the gaps; check each failure against jsdom before trusting it |
| Vitest browser mode | Yes | Real (through a browser driver) | Slower | Layout, focus across real elements, CSS-driven visibility, canvas, observers |
| Playwright component testing | Yes | Real | Slower | Teams already on Playwright; components that need a real engine |
| Storybook interaction tests | Yes | Real in the browser | Medium | Components already documented as stories; one play function per state |

Install `jsdom` as an explicit dev dependency, so its version is pinned rather than whatever the
runner's environment package resolves (a fresh setup in a field trial got jsdom 29); the evidence
here used jsdom 30.1.2. Add `axe-core` for the accessibility checks in
[checks.md](checks.md). In a CommonJS package (no `"type": "module"`), Vitest's config prints a
Vite warning about loading an ESM config: set `"type": "module"` in `package.json` or name the
file `vitest.config.mts`.

Gaps measured in jsdom 30: no `matchMedia`, `IntersectionObserver`, `ResizeObserver` or
`Element.scrollIntoView`; `HTMLDialogElement` exists but has no `showModal`;
`getBoundingClientRect` returns zeros; canvas `getContext` is not implemented, which is also
why axe-core cannot compute color contrast there. Stub only the API the component calls, in a
setup file, with the behavior the test needs (a `matchMedia` that answers for the breakpoint
under test), and move anything that depends on real layout to a browser runner.

## React

Write one render helper that builds fresh providers per test and returns a user-event
instance created before render:

```tsx
function renderWithProviders(ui: ReactElement, options: { route?: string; preloadedState?: Partial<RootState> } = {}) {
	const store = makeStore(options.preloadedState);
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

	function Providers(props: { children: ReactNode }) {
		return (
			<Provider store={store}>
				<QueryClientProvider client={queryClient}>
					<MemoryRouter initialEntries={[options.route ?? "/"]}>{props.children}</MemoryRouter>
				</QueryClientProvider>
			</Provider>
		);
	}

	return { store, user: userEvent.setup(), ...render(ui, { wrapper: Providers }) };
}
```

- **Fresh state per test.** A new store, query client and router per render. A module-level
  singleton store (common with Zustand and hand-rolled stores) needs a reset in `afterEach`.
- **Data libraries.** Turn retries off in tests (TanStack Query retries failed queries three
  times with backoff by default, so an error-state test waits seconds or times out). Fake the
  network with MSW rather than seeding the cache, unless the cache contents are the subject.
- **Routers.** Render the route tree in a memory router at the starting URL, act, then assert
  the next page's heading. Do not mock `useNavigate` or `useRouter` to assert it was called; that
  passes when the route is wrong.
- **State libraries.** Use the real store with preloaded state; assert what the UI shows after
  an action, and read the store only when the state is the contract (persisted drafts).
- **Hooks.** Test a hook through a component that uses it. `renderHook` fits a hook that is a
  public API on its own (a shared library hook); pass the same `wrapper`.
- **Portals and modals.** Query through `screen`; assert focus moves into the dialog on open
  and back to the trigger on close, and that Escape closes it.
- **Error boundaries.** Render a child that throws, assert the fallback, and allow the expected
  `console.error` by exact text.
- **Server Components.** Testing Library renders client components; render async server
  components' output only if your framework version documents support for it. Otherwise test
  the server data logic as units and the composed page with an end-to-end tour.

## Vue

`@testing-library/vue` (`render(Component, { props, global: { plugins: [router, pinia] } })`) or
Vue Test Utils `mount`. Avoid `shallowMount` and `stubs` for the component's own children.
With Pinia's `createTestingPinia`, actions are stubbed by default; pass `stubActions: false`
when the action is part of the behavior under test.

## Svelte

`@testing-library/svelte` `render(Component, { props })`. Assert through the DOM, not component
internals; context goes through the `context` option.

## Angular

`@testing-library/angular` `render(Component, { imports, providers })` runs change detection for
you. Prefer MSW or a fake service provider over `HttpTestingController` expectations that
restate the implementation; inject real child components rather than `NO_ERRORS_SCHEMA`.

## Solid

`@solidjs/testing-library` `render(function view() { return <Counter />; })`. Same queries and
user-event.

## Storybook interaction tests

A play function receives the story's canvas: query it with the same role queries, act with
user-event, assert with `expect`. Write one story per state (empty, error, loading, filled),
serve the network with the same MSW handlers, and run the stories in CI with the Storybook test
runner or its Vitest integration. Stories nobody runs in CI are documentation, not tests.

## Playwright component testing and browser mode

Mount the component in a real page and use locators (`getByRole`, `getByLabel`) with
auto-retrying assertions. Props must be serializable across the page boundary in Playwright
component testing; wrap complex setups in a test-only story component. Prefer these runners for
anything that needs layout, scrolling, real focus behavior or contrast.
