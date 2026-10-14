"""Explore the demo shop with Hypothesis stateful testing and Playwright.

    BUGGY_SHOP_FIXED=1 python -m pytest examples/buggy-shop/hypothesis -q   # fixed build: passes
    python -m pytest examples/buggy-shop/hypothesis -q                      # with bugs: fails, shrunk

Needs `hypothesis`, `playwright` and `pytest`, plus Chrome or Chromium (set CHROME to its path).
Every property asserts on its own line, so Hypothesis reports each distinct bug separately.
"""

import os
import re
import subprocess
import time
import urllib.request
from pathlib import Path

import pytest
from hypothesis import HealthCheck, settings, strategies as st
from hypothesis.stateful import RuleBasedStateMachine, invariant, rule
from playwright.sync_api import sync_playwright

PORT = int(os.environ.get("BUGGY_SHOP_PORT", "8767"))
URL = f"http://127.0.0.1:{PORT}/"
FIXED = os.environ.get("BUGGY_SHOP_FIXED") == "1"
SERVER = Path(__file__).resolve().parent.parent / "serve.mjs"

HOSTILE_TEXT = [
    "",
    "0",
    "-1",
    "1e309",
    "99999999999999999999",
    "😀👍🏽",
    '"><img src=x onerror="window.__exploreInjected=1">',
    "'; DROP TABLE users; --",
]
KEYS = ["Escape", "Enter", "Tab", " "]
CLICKABLE = (
    'button, a[href], summary, input[type="checkbox"], input[type="radio"], input[type="submit"], input[type="button"], '
    '[role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="switch"], [role="option"]'
)
TYPEABLE = 'input:not([type]), input[type="text"], input[type="number"], input[type="search"], input[type="email"], textarea, [contenteditable]:not([contenteditable="false"])'
MODAL = 'dialog[open]:modal, [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]'
BUSY = '[aria-busy="true"], [role="progressbar"]:not([aria-valuenow])'
BROKEN = re.compile(r"\b(?:NaN|undefined|Infinity)\b|\[object Object\]|Invalid Date")

READ_PAGE = """function readPage(selectors) {
  function cents(text) {
    const match = /^\\$(\\d+)\\.(\\d{2})$/.exec((text ?? '').trim());
    return match ? Number(match[1]) * 100 + Number(match[2]) : null;
  }
  function visible(element) {
    return element instanceof HTMLElement && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && element.getClientRects().length > 0;
  }
  return {
    text: document.body.innerText,
    modal: Array.from(document.querySelectorAll(selectors.modal)).some(visible),
    busy: Array.from(document.querySelectorAll(selectors.busy)).some(visible),
    injected: window.__exploreInjected === 1,
    lines: Array.from(document.querySelectorAll('#cart tbody tr')).map(function line(row) { return cents(row.children[2]?.textContent); }),
    total: cents(document.getElementById('total')?.textContent),
    discounted: /Coupon applied/.test(document.getElementById('coupon-message')?.textContent ?? ''),
  };
}"""

MARK = """function markCandidates(query) {
  function visible(element) {
    return element instanceof HTMLElement && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && element.getClientRects().length > 0;
  }
  function sameOrigin(element) {
    return !(element instanceof HTMLAnchorElement) || new URL(element.href, location.href).origin === location.origin;
  }
  const scope = Array.from(document.querySelectorAll(query.modal)).filter(visible).at(-1) ?? document;
  const found = Array.from(scope.querySelectorAll(query.selector)).filter(function usable(element) {
    return visible(element) && !element.closest('[inert]') && !element.matches(':disabled') && sameOrigin(element);
  });
  document.querySelectorAll('[data-explore-pick]').forEach(function unmark(element) { element.removeAttribute('data-explore-pick'); });
  found.forEach(function mark(element, index) { element.setAttribute('data-explore-pick', String(index)); });
  return found.length;
}"""

IDLE = """function idle(busy) {
  return !Array.from(document.querySelectorAll(busy)).some(function visible(element) {
    return element instanceof HTMLElement && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && element.getClientRects().length > 0;
  });
}"""


def is_echo(text, index, length, typed):
    """Whether a broken token at text[index:index + length] lies inside text the run typed."""
    for value in typed:
        start = text.find(value)
        while value and start != -1:
            if start <= index and index + length <= start + len(value):
                return True
            start = text.find(value, start + 1)
    return False


def wait_for_server(server):
    """Wait until the demo server answers with the requested build, or fail the run."""
    expected = f"SHOP_FIXED = {'true' if FIXED else 'false'}"
    for _ in range(100):
        if server.poll() is not None:
            pytest.fail(f"the demo server exited; is port {PORT} already in use?")
        try:
            with urllib.request.urlopen(URL + "config.js", timeout=1) as response:
                if expected not in response.read().decode():
                    pytest.fail(f"port {PORT} serves the other build of the shop; stop that server first")
                return
        except OSError:
            # audit-tests-ignore sleep: polling for the server to start, bounded by the loop
            time.sleep(0.1)
    pytest.fail(f"the demo server did not answer on port {PORT}")


@pytest.fixture(scope="module")
def browser():
    """Start the demo server and a headless browser for the whole module."""
    server = subprocess.Popen(["node", str(SERVER), *(["--fixed"] if FIXED else [])], env={**os.environ, "PORT": str(PORT)})
    try:
        wait_for_server(server)
        with sync_playwright() as playwright:
            launched = playwright.chromium.launch(executable_path=os.environ.get("CHROME") or None, headless=True)
            try:
                yield launched
            finally:
                launched.close()
    finally:
        server.terminate()


def test_explore(browser):
    """Random sequences of clicks, typing, keys and waits never violate a property."""

    class Shop(RuleBasedStateMachine):
        """The shop as Hypothesis sees it: every rule is an action, every check runs after it."""

        def __init__(self):
            super().__init__()
            self.context = browser.new_context()
            self.page = self.context.new_page()
            self.errors = []
            self.checked = 0
            self.typed = []
            self.page.on("pageerror", self.record_error)
            self.page.goto(URL)
            self.before = self.read()
            self.last_key = None
            self.settled = True

        def record_error(self, error):
            """Keep every page error; the invariant reports those since its last check."""
            self.errors.append(str(error))

        def read(self):
            return self.page.evaluate(READ_PAGE, {"modal": MODAL, "busy": BUSY})

        def target(self, selector, pick):
            """The pick-th candidate on screen now, or None when there is none."""
            count = self.page.evaluate(MARK, {"selector": selector, "modal": MODAL})
            return self.page.locator(f'[data-explore-pick="{pick % count}"]') if count else None

        def act(self, perform):
            self.before = self.read()
            self.last_key = None
            try:
                perform()
            except Exception:  # noqa: BLE001 - a target that vanished is a no-op, not a finding
                pass
            try:
                self.page.wait_for_function(IDLE, arg=BUSY, timeout=3000)
                self.settled = True
            except Exception:  # noqa: BLE001 - timing out is what the busy property judges
                self.settled = False

        @rule(pick=st.integers(0, 50))
        def click(self, pick):
            target = self.target(CLICKABLE, pick)
            if target is not None:

                def perform():
                    target.click(timeout=1000)

                self.act(perform)

        @rule(pick=st.integers(0, 50), text=st.sampled_from(HOSTILE_TEXT) | st.text(max_size=6))
        def type_text(self, pick, text):
            target = self.target(TYPEABLE, pick)
            if target is not None:

                def perform():
                    target.fill(text, timeout=1000)
                    self.typed.append(text)  # only text that went in can be echoed back

                self.act(perform)

        @rule(key=st.sampled_from(KEYS))
        def press(self, key):
            def perform():
                self.page.keyboard.press(key)

            self.act(perform)
            self.last_key = key

        @rule(ms=st.sampled_from([100, 700]))
        def wait(self, ms):
            def perform():
                self.page.wait_for_timeout(ms)

            self.act(perform)

        @invariant()
        def no_uncaught_errors(self):
            fresh, self.checked = self.errors[self.checked :], len(self.errors)
            assert not fresh, f"uncaught: {fresh[0]}"

        @invariant()
        def no_broken_values(self):
            text = self.read()["text"]
            broken = [m.group(0) for m in BROKEN.finditer(text) if not is_echo(text, m.start(), len(m.group(0)), self.typed)]
            assert not broken, f"visible {broken[0]!r}"

        @invariant()
        def injected_text_stays_inert(self):
            assert not self.read()["injected"], "typed markup executed"

        @invariant()
        def escape_closes_dialogs(self):
            after = self.read()
            assert not (self.last_key == "Escape" and self.before["modal"] and after["modal"] and not after["busy"]), "Escape left the modal open"

        @invariant()
        def busy_indicators_settle(self):
            assert self.settled, "a busy indicator did not clear within 3 s"

        @invariant()
        def cart_total_adds_up(self):
            state = self.read()
            if state["discounted"] or state["total"] is None or None in state["lines"]:
                return
            assert state["total"] == sum(state["lines"]), f"total {state['total']} != sum of lines {sum(state['lines'])}"

        def teardown(self):
            self.context.close()

    Shop.TestCase.settings = settings(
        max_examples=int(os.environ.get("EXPLORE_EXAMPLES", "60")),
        stateful_step_count=20,
        deadline=None,
        suppress_health_check=[HealthCheck.too_slow],
        report_multiple_bugs=True,
    )
    Shop.TestCase().runTest()
