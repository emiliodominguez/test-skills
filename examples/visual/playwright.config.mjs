// Playwright Test project for the visual regression example. Baselines and run output go under
// VISUAL_OUT (verify.mjs points it at a fresh temporary directory), so no screenshots or
// test-results folder land in the repository. Rendering is pinned: one browser binary, a fixed
// viewport and device scale factor, light scheme, UTC and en-US.
//
// CHROME optionally names the Chromium executable to launch; without it Playwright uses its own
// installed browser. The verified runs used CHROME=/opt/pw-browsers/chromium (Chromium 141); the
// browser bundled with Playwright 1.64 is Chromium 156, whose pixel counts may differ.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

const out = process.env.VISUAL_OUT ?? join(tmpdir(), "test-skills-visual");

export default defineConfig({
	testDir: ".",
	testMatch: "*.spec.mjs",
	outputDir: join(out, "results"),
	snapshotPathTemplate: join(out, "baselines", "{testFileName}", "{arg}{ext}"),
	fullyParallel: false,
	workers: 1,
	retries: 0,
	reporter: "list",
	// No project-wide maxDiffPixels: with none set, a single differing pixel fails. Playwright 1.64
	// applies the stricter of maxDiffPixels and maxDiffPixelRatio when both are set, so a project
	// default of 0 would silently override a per-test ratio.
	expect: {
		toHaveScreenshot: { threshold: 0.2 },
	},
	use: {
		viewport: { width: 800, height: 400 },
		deviceScaleFactor: 1,
		colorScheme: "light",
		locale: "en-US",
		timezoneId: "UTC",
		launchOptions: { executablePath: process.env.CHROME || undefined },
	},
});
