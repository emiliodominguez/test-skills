# End-to-end drivers

| Driver | Targets | Waiting model | Strengths | Watch out for |
| --- | --- | --- | --- | --- |
| Playwright | Chromium, Firefox, WebKit, Electron | Auto-waits on actionability; web-first assertions retry | Traces with DOM snapshots, network control, parallel workers, component testing | WebKit on Linux differs from Safari; keep one browser per change, the rest scheduled |
| Cypress | Chromium-family, Firefox, WebKit (experimental) | Commands retry until timeout | Interactive runner, time-travel debugging | Runs inside the page: multi-tab, multi-origin and native dialogs need workarounds |
| WebdriverIO, Selenium | Every browser through WebDriver, real devices through Appium | Explicit waits | Grids, vendor clouds, legacy browsers | Slower; flakiness from implicit waits mixed with explicit ones |
| Maestro | Android, iOS, React Native, Flutter | Waits for the UI to settle | Readable YAML flows, fast authoring | Limited logic; assertions are visual and text based |
| Detox | React Native | Synchronizes with the app's idle state (network, timers, animations) | Grey-box sync removes most sleeps | React Native only; native build per run |
| Espresso, XCUITest | Native Android, native iOS | Idle synchronization (Espresso); explicit expectations (XCUITest) | Fast, stable, first-party | One platform each |
| Appium | Android and iOS, native and hybrid | Explicit waits | One API across platforms and languages | Slowest; needs device farm discipline |

## Choosing

- Same language and runner as the rest of the suite beats a marginally better tool.
- Prefer drivers that wait on application readiness over ones that need explicit sleeps.
- For desktop shells (Electron, Tauri), drive the real window through the framework's automation
  hook (Playwright's Electron support, WebDriver for Tauri) and fence native dialogs.
- Keep tours few and high value; push rules down to component, integration and unit tests, and
  rules on unscripted paths to exploration.

## Network and services

Intercept at the network layer (the driver's routing API, or a mock server such as MSW or
WireMock) for third parties you do not control; hit your own backend for real in at least the
smoke tours, or the suite proves only that the mocks agree with the UI.
