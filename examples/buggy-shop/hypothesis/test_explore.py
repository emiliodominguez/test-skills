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
CLICKABLE = 'button, a[href], [role="button"], input[type="checkbox"], input[type="radio"], summary'
TYPEABLE = 'input:not([type]), input[type="text"], input[type="number"], input[type="search"], textarea'
BROKEN = re.compile(r"\b(?:NaN|undefined|Infinity)\b|\[object Object\]|Invalid Date")

READ_PAGE = """function readPage() {
  function cents(text) {
    const match = /^\\$(\\d+)\\.(\\d{2})$/.exec((text ?? '').trim());
    return match ? Number(match[1]) * 100 + Number(match[2]) : null;
  }
  function visible(element) {
    return element instanceof HTMLElement && !element.hidden && element.offsetParent !== null;
  }
  return {
    text: document.body.innerText,
    modal: document.querySelector('dialog[open]:modal') !== null,
    busy: Array.from(document.querySelectorAll('[aria-busy="true"], [role="progressbar"]')).some(visible),
    injected: window.__exploreInjected === 1,
    lines: Array.from(document.querySelectorAll('#cart tbody tr')).map(function line(row) { return cents(row.children[2]?.textContent); }),
    total: cents(document.getElementById('total')?.textContent),
    discounted: /Coupon applied/.test(document.getElementById('coupon-message')?.textContent ?? ''),
  };
}"""

MARK = """function markCandidates(selector) {
  const scope = document.querySelector('dialog[open]:modal') ?? document;
  const found = Array.from(scope.querySelectorAll(selector)).filter(function usable(element) {
    return !element.closest('[inert]') && !element.matches(':disabled') && element.offsetParent !== null;
  });
  document.querySelectorAll('[data-explore-pick]').forEach(function unmark(element) { element.removeAttribute('data-explore-pick'); });
  found.forEach(function mark(element, index) { element.setAttribute('data-explore-pick', String(index)); });
  return found.length;
}"""

IDLE = """function idle() {
  return !Array.from(document.querySelectorAll('[aria-busy="true"], [role="progressbar"]')).some(function visible(element) {
    return !element.hidden && element.offsetParent !== null;
  });
}"""


@pytest.fixture(scope="module")
def browser():
    """Start the demo server and a headless browser for the whole module."""
    server = subprocess.Popen(["node", str(SERVER), *(["--fixed"] if FIXED else [])], env={**os.environ, "PORT": str(PORT)})
    for _ in range(100):
        try:
            urllib.request.urlopen(URL, timeout=1)
            break
        except OSError:
            time.sleep(0.1)
    with sync_playwright() as playwright:
        launched = playwright.chromium.launch(executable_path=os.environ.get("CHROME") or None, headless=True)
        yield launched
        launched.close()
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
            self.typed = []
            self.page.on("pageerror", lambda error: self.errors.append(str(error)))
            self.page.goto(URL)
            self.before = self.read()
            self.last_key = None

        def read(self):
            return self.page.evaluate(READ_PAGE)

        def act(self, perform):
            self.before = self.read()
            self.errors.clear()
            self.last_key = None
            try:
                perform()
            except Exception:  # noqa: BLE001 - a target that vanished is a no-op, not a finding
                pass
            try:
                self.page.wait_for_function(IDLE, timeout=3000)
                self.settled = True
            except Exception:  # noqa: BLE001 - timing out is what the busy property judges
                self.settled = False

        @rule(pick=st.integers(0, 50))
        def click(self, pick):
            count = self.page.evaluate(MARK, CLICKABLE)
            if count:
                self.act(lambda: self.page.locator(f'[data-explore-pick="{pick % count}"]').click(timeout=1000))

        @rule(pick=st.integers(0, 50), text=st.sampled_from(HOSTILE_TEXT) | st.text(max_size=6))
        def type_text(self, pick, text):
            count = self.page.evaluate(MARK, TYPEABLE)
            if count:
                self.typed.append(text)
                self.act(lambda: self.page.locator(f'[data-explore-pick="{pick % count}"]').fill(text, timeout=1000))

        @rule(key=st.sampled_from(KEYS))
        def press(self, key):
            self.act(lambda: self.page.keyboard.press(key))
            self.last_key = key

        @rule(ms=st.sampled_from([100, 700]))
        def wait(self, ms):
            self.act(lambda: self.page.wait_for_timeout(ms))

        @invariant()
        def no_uncaught_errors(self):
            assert not self.errors, f"uncaught: {self.errors[0]}"

        @invariant()
        def no_broken_values(self):
            broken = [m for m in BROKEN.findall(self.read()["text"]) if not any(m in t for t in self.typed)]
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
            assert getattr(self, "settled", True), "a busy indicator did not clear within 3 s"

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
