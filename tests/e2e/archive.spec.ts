import { expect, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { login, setupSyntheticSession } from "./helpers";

// build-plan P6 acceptance: a full mock session produces two DOCX files, a
// long.csv row set, a zip, and a session record in state "done", using the
// in-memory store.
test("a mock session archives, runs pass two, and produces every output", async ({ page }) => {
  test.setTimeout(150_000);
  await login(page);
  const id = await setupSyntheticSession(page);

  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByTestId("session-state")).toHaveText("Live");
  await page.waitForTimeout(12_000);
  await page.getByRole("button", { name: "Stop" }).click();

  const review = page.getByRole("link", { name: "Archived. Review session" });
  await expect(review).toBeVisible({ timeout: 30_000 });
  await review.click();
  await expect(page).toHaveURL(new RegExp(`/review/${id}$`));
  await expect(page.getByTestId("review-state")).toHaveText("State: closing");

  await page.getByRole("button", { name: "Run pass two" }).click();
  await expect(page.getByTestId("review-state")).toHaveText("State: done", { timeout: 30_000 });
  await expect(page.getByRole("link", { name: "A.docx" })).toBeVisible();

  const get = async (url: string) => {
    const r = await page.request.get(url);
    expect(r.ok(), `${url} returned ${r.status()}`).toBe(true);
    return new Uint8Array(await r.body());
  };

  for (const student of ["A", "B"]) {
    const docx = await get(
      `/api/file?pathname=${encodeURIComponent(`documents/${id}/${student}.docx`)}`,
    );
    const xml = strFromU8(unzipSync(docx)["word/document.xml"]);
    expect(xml).toContain(`Viva Voice report: student ${student}`);
    expect(xml).toContain("Speech rate WPM");
  }

  const long = strFromU8(await get("/api/export?examId=demo-exam&format=long"))
    .trim()
    .split("\n");
  expect(long[0]).toBe(
    "examId,sessionId,participantId,pass,featureId,window,threshold,value,unit,pipelineVersion",
  );
  const mine = long.filter((r) => r.split(",")[1] === id);
  expect(mine.length).toBeGreaterThan(100);
  expect(new Set(mine.map((r) => r.split(",")[3]))).toEqual(new Set(["1", "2"]));

  const zip = unzipSync(await get(`/api/bundle?sessionId=${id}`));
  expect(Object.keys(zip).sort()).toEqual(
    [
      "A.docx",
      "B.docx",
      "energy.json",
      "session.json",
      "stereo.wav",
      "transcript-pass1.json",
      "transcript-pass2.json",
    ].sort(),
  );
  expect(strFromU8(zip["stereo.wav"].subarray(0, 4))).toBe("RIFF");

  const rec = JSON.parse(
    strFromU8(await get(`/api/file?pathname=${encodeURIComponent(`sessions/${id}.json`)}`)),
  );
  expect(rec.state).toBe("done");
  expect(rec.passes["1"]).toBeTruthy();
  expect(rec.passes["2"]).toBeTruthy();
  expect(rec.events.some((e: { type: string }) => e.type === "archive")).toBe(true);
});
