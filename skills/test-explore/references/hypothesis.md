# Hypothesis + Playwright

Stateful exploration for Python projects: a `RuleBasedStateMachine` whose rules are user actions
and whose invariants are the properties, driven against a live page with Playwright's sync API.
Hypothesis shrinks a failing run to the shortest rule sequence, reports each distinct failure
separately, and stores failures in its example database so the next run replays them first.
Verified with Hypothesis 6.169 and Playwright 1.64 for Python on Chromium; the complete harness
is `examples/buggy-shop/hypothesis/test_explore.py` in this repository.

## Shape

```python
class Shop(RuleBasedStateMachine):
    def __init__(self):
        super().__init__()
        self.context = browser.new_context()          # fresh state per example
        self.page = self.context.new_page()
        self.errors, self.typed = [], []
        self.page.on("pageerror", self.record_error)
        self.page.goto(URL)

    @rule(pick=st.integers(0, 50))
    def click(self, pick):
        count = self.page.evaluate(MARK, CLICKABLE)    # mark what is on screen now
        if count:
            self.act(self.click_target(pick % count))  # resolve the target at run time

    @rule(pick=st.integers(0, 50), text=st.sampled_from(HOSTILE_TEXT) | st.text(max_size=6))
    def type_text(self, pick, text): ...

    @invariant()
    def cart_total_adds_up(self):
        state = self.read()
        if state["total"] is None or None in state["lines"]:
            return                                       # not judgeable yet
        assert state["total"] == sum(state["lines"]), "total does not add up"

    def teardown(self):
        self.context.close()
```

## Rules of thumb

- **One assertion per property, each on its own line.** Hypothesis groups failures by exception
  type and location; with `report_multiple_bugs=True` (the default) it reports every distinct
  bug from one run instead of the first.
- **Settings:** `deadline=None` (browser steps are slow and variable), `stateful_step_count`
  around 20, `max_examples` as the budget knob, and suppress the `too_slow` health check.
- **Keep the database.** `.hypothesis/` replays known failures first, which makes a fix loop take
  seconds; ignore it in version control or share it deliberately in CI.
- **Preconditions and bundles:** use `@precondition` for actions valid only in some states (a
  dialog is open) and `Bundle` when a rule creates things later rules act on (created records).
- **Transition rules** (after Escape the modal is gone) compare a snapshot taken before the action
  with the state after it.
- **Echoes are not bugs:** ignore broken-value matches that occur in text the run typed.

## Measured on the demo shop

Sixty examples of twenty steps, the fixed build passing every time: all six seeded bugs reported
as distinct failures in the latest run, and five of six (not the stuck spinner, which needs five
specific steps) in two earlier runs, each shrunk to two or three steps. When a multi-step bug is
missed, raise `max_examples` or add a workflow rule for that flow.
