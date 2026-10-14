// Visual checks for page.html. VISUAL_VARIANT=buggy serves the seeded 6px button shift.
// Titles carry tags so verify.mjs can select a group with --grep:
//   @stable   deterministic checks: a component in isolation and a page with every dynamic region controlled
//   @unstable the same page with its clock and random promotion left alone (animations still disabled)
//   @animated the controlled page with its CSS animation allowed to run
//   @loose    the component compared with a threshold loose enough to accept the seeded bug
import { expect, test } from "@playwright/test";

const variant = process.env.VISUAL_VARIANT === "buggy" ? "buggy" : "correct";
const pageUrl = `${new URL("./page.html", import.meta.url).href}?variant=${variant}`;

/**
 * Open the demo page and wait until its web fonts, if any, are ready.
 *
 * @param {import("@playwright/test").Page} page - The page under test.
 * @returns {Promise<void>} Resolves once the page is loaded and fonts are ready.
 */
async function openPage(page) {
	await page.goto(pageUrl);
	await page.evaluate(async function fontsReady() {
		await document.fonts.ready;
	});
}

test("plan card @stable", async function planCard({ page }) {
	await openPage(page);
	await expect(page.getByTestId("plan-card")).toHaveScreenshot("plan-card.png");
});

test("status page, dynamic regions controlled @stable", async function statusControlled({ page }) {
	await page.clock.setFixedTime(new Date("2026-01-15T09:30:00Z"));
	await openPage(page);
	await expect(page).toHaveScreenshot("status-controlled.png", {
		animations: "disabled",
		caret: "hide",
		mask: [page.getByTestId("promo")],
	});
});

test("status page, clock and promotion left alone @unstable", async function statusUncontrolled({ page }) {
	await openPage(page);
	await expect(page).toHaveScreenshot("status-uncontrolled.png", { animations: "disabled", caret: "hide" });
});

test("status page, animation running @animated", async function statusAnimated({ page }) {
	await page.clock.setFixedTime(new Date("2026-01-15T09:30:00Z"));
	await openPage(page);
	await expect(page).toHaveScreenshot("status-animated.png", {
		animations: "allow",
		caret: "hide",
		mask: [page.getByTestId("promo")],
	});
});

test("plan card with a loose threshold @loose", async function planCardLoose({ page }) {
	await openPage(page);
	await expect(page.getByTestId("plan-card")).toHaveScreenshot("plan-card.png", { maxDiffPixelRatio: 0.05 });
});
