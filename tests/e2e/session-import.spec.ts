import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { FIXTURE_MANIFEST, makeSessionFixture } from "../../lib/import/synthetic";
import { expectDescriptiveText, login } from "./helpers";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

// Work order 02, test 8: the session file import page, end to end, on a
// synthetic 24-bit stereo file with three pairs and a swapped second pair.
test("session file import: segment, review, upload, exclude, pass two, download", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await login(page);
  const run = Date.now().toString(36);
  const examId = `e2e-import-${run}`;
  const label = `E2E_S1_${run}`;
  const fx = makeSessionFixture();

  // S03 declined, so pair 2 (left S04, right S03) goes in excluded.
  const roster = ["S01", "S02", "S03", "S04", "S05", "S06"].map((id) => ({
    name: `Tone ${id}`,
    participantId: id,
    consentStatus: id === "S03" ? "declined" : "granted",
  }));
  expect((await page.request.post(`/api/roster?examId=${examId}`, { data: roster })).ok()).toBe(
    true,
  );

  await page.goto("/import/session");
  await page.getByRole("radio", { name: "Single session file" }).check();
  await page.getByLabel("Exam id").fill(examId);
  await page.getByRole("button", { name: "Check exam" }).click();
  await page.getByLabel("Exam title").fill("Synthetic midterm");
  await page.getByLabel("Exam duration in minutes").fill("5");
  await page.getByRole("button", { name: "Create exam" }).click();
  await expect(page.getByTestId("exam-found")).toContainText("5 minutes, 0 target patterns");

  await page.getByLabel("Session label").fill(label);
  await page.getByLabel("Session label").blur();
  await page.getByLabel("Session date").fill("2026-10-19");
  await page.getByLabel("Manifest CSV").setInputFiles({
    name: "manifest.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(FIXTURE_MANIFEST),
  });
  await expect(page.getByLabel("Left channel ID, row 2")).toHaveValue("S04");

  await page.getByLabel("Session WAV").setInputFiles({
    name: "session.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from(fx.bytes),
  });
  await expect(page.getByTestId("file-info")).toContainText("48000 Hz, 24-bit PCM, 2 channels");
  await page.getByRole("button", { name: "Find pairs" }).click();
  await expect(page.getByTestId("segment-count")).toHaveText("3 segments, 3 manifest rows.", {
    timeout: 30_000,
  });
  await expect(page.getByTestId("segment").nth(0).getByTestId("segment-times")).toHaveText(
    "0:03.000 to 0:05.500 (0:02.500)",
  );
  await expect(page.getByTestId("segment").nth(1).getByTestId("segment-row")).toHaveText(
    "Manifest row 2: left S04, right S03",
  );
  await expect(page.getByTestId("segment").nth(1).getByTestId("consent-excluded")).toHaveText(
    "excluded: consent (S03 declined)",
  );
  await expectDescriptiveText(page);

  // A segment-count mismatch blocks the upload and names both numbers.
  await page.getByRole("button", { name: "Remove row 3" }).click();
  await expect(page.getByTestId("upload-blocked")).toContainText(
    "The file has 3 segments and the manifest has 2 rows.",
  );
  await expect(page.getByRole("button", { name: "Upload session" })).toBeDisabled();
  await page.getByRole("button", { name: "Add pair" }).click();
  await page.getByLabel("Left channel ID, row 3").fill("S05");
  await page.getByLabel("Right channel ID, row 3").fill("S06");
  await expect(page.getByTestId("upload-blocked")).toHaveCount(0);

  // Playing a segment builds its slice in the browser.
  await page.getByTestId("segment").nth(0).getByRole("button", { name: "Play" }).click();
  await expect(page.getByTestId("segment").nth(0).locator("audio")).toHaveCount(1);

  await page.getByRole("button", { name: "Upload session" }).click();
  await expect(page.getByTestId("upload-done")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("upload-files").getByTestId("upload-state")).toHaveText(
    Array(12).fill(/^done/),
  );

  const get = (p: string) => page.request.get(`/api/file?pathname=${encodeURIComponent(p)}`);
  const raw = await (await get(`sessions-raw/${label}.wav`)).body();
  expect(sha(raw)).toBe(sha(fx.bytes));
  const p2 = await (await get(`sessions/${label}-P02.json`)).json();
  expect(p2.captureMode).toBe("file-import");
  expect(p2.participantIds).toEqual({ A: "S04", B: "S03" });
  expect(p2.excluded.reason).toBe("consent");
  expect(p2.source).toMatchObject({
    sessionLabel: label,
    rawPath: `sessions-raw/${label}.wav`,
    startFrame: fx.segments[1].start,
    endFrame: fx.segments[1].end,
  });

  await page.getByRole("button", { name: "Run pass two for all pairs" }).click();
  await expect(page.getByTestId(`pass2-${label}-P03`)).toContainText(": done", { timeout: 60_000 });
  await expect(page.getByTestId(`pass2-${label}-P01`)).toContainText(": done");
  await expect(page.getByTestId(`pass2-${label}-P02`)).toContainText("skipped, excluded: consent");
  expect((await get(`documents/${label}-P02/A.docx`)).status()).toBe(404);

  const zip = unzipSync(
    new Uint8Array(await (await page.request.get(`/api/session-download?label=${label}`)).body()),
  );
  expect(Object.keys(zip).filter((n) => n.endsWith(".docx"))).toHaveLength(4);

  await page.goto("/review");
  const group = page.getByTestId(`group-${label}`);
  await expect(group).toContainText("file import, 2026-10-19");
  await expect(group.getByTestId(`session-${label}-P02`)).toContainText("excluded: consent");
  await expect(group.getByRole("link", { name: "Download all" })).toBeVisible();
  await expectDescriptiveText(page);
});

test("session file import rejects a mono file and names its format", async ({ page }) => {
  await login(page);
  await page.goto("/import/session");
  await page.getByRole("radio", { name: "Single session file" }).check();
  await page.getByLabel("Session WAV").setInputFiles({
    name: "mono.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from(makeSessionFixture({ channels: 1, pairFrames: [4800] }).bytes),
  });
  await expect(page.getByTestId("file-message")).toContainText(
    "This file contains 1 channel, 48000 Hz, 24-bit PCM.",
  );
  await expect(page.getByRole("button", { name: "Find pairs" })).toBeDisabled();
});
