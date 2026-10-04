import { expect, test } from "@playwright/test";
import { login, readSessionRecord, setupSyntheticSession } from "./helpers";

// build-plan P5.6: a mock-transcriber session runs 30 s; the index slot stays
// hidden until a score tap, then shows a value; Stop writes the markers and
// the state "closing".
test("live display: hidden index until a score, then Stop closes the session", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  const id = await setupSyntheticSession(page);

  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByTestId("session-state")).toHaveText("Live");
  const t0 = Date.now();

  // Nothing on the display scrolls at 1280x800.
  const size = await page.evaluate(() => ({
    sh: document.documentElement.scrollHeight,
    sw: document.documentElement.scrollWidth,
    h: window.innerHeight,
    w: window.innerWidth,
    scrollers: [...document.querySelectorAll("*")].filter(
      (el) =>
        el.scrollHeight > el.clientHeight + 1 &&
        getComputedStyle(el).overflowY !== "visible" &&
        getComputedStyle(el).overflowY !== "hidden",
    ).length,
  }));
  expect(size.sh).toBeLessThanOrEqual(size.h);
  expect(size.sw).toBeLessThanOrEqual(size.w);
  expect(size.scrollers).toBe(0);

  // The first recompute lands at 10 s; the slot must stay hidden through it.
  await expect(page.getByTestId("index-A")).toHaveAttribute("data-hidden", "true");
  await page.waitForTimeout(12_000);
  await expect(page.getByTestId("index-A")).toHaveAttribute("data-hidden", "true");
  await expect(page.getByTestId("index-B")).toHaveAttribute("data-hidden", "true");

  await page.getByRole("button", { name: "Score 4" }).click();
  await expect(page.getByRole("button", { name: "Score 4" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("index-A")).toHaveAttribute("data-hidden", "false");
  await expect(page.getByTestId("index-A")).toContainText(/\d+ ?wpm/);
  await expect(page.getByTestId("index-B")).toContainText(/\d/);

  // The mock replays the balanced fixture; A says "would like to" about 7 s in.
  await expect(page.getByTestId("targets-A")).toHaveText("1");
  await page.screenshot({ path: "test-results/live-display.png" });

  await page.waitForTimeout(Math.max(0, 30_000 - (Date.now() - t0)));
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByTestId("session-state")).toHaveText("Stopped and saved", {
    timeout: 15_000,
  });

  const rec = (await readSessionRecord(page, id)) as {
    state: string;
    markers: { startMs: number; stopMs: number };
    instructorLiveScore: { value: number; atMs: number };
    events: { type: string }[];
  };
  expect(rec.state).toBe("closing");
  expect(rec.markers.startMs).not.toBeNull();
  const ran = rec.markers.stopMs - rec.markers.startMs;
  expect(ran).toBeGreaterThan(28_000);
  expect(ran).toBeLessThan(40_000);
  expect(rec.instructorLiveScore.value).toBe(4);
  expect(rec.events.map((e) => e.type)).toEqual(
    expect.arrayContaining(["setup", "start", "score", "stop"]),
  );
});
