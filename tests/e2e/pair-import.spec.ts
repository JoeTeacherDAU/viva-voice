import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { makePairFixture } from "../../lib/import/synthetic";
import { expectDescriptiveText, login } from "./helpers";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const wav = (f: { name: string; bytes: Uint8Array }) => ({
  name: f.name,
  mimeType: "audio/wav",
  buffer: Buffer.from(f.bytes),
});

// Work order 03, test 5: pair files mode, end to end, on three synthetic
// 24-bit pair files and their manifest.
test("pair file import: match by name, block, upload unchanged, pass two", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  const run = Date.now().toString(36);
  const examId = `e2e-pairs-${run}`;
  const label = `E2E_PF_${run}`;
  const fx = makePairFixture(label);

  const roster = ["S01", "S02", "S03", "S04", "S05", "S06"].map((id) => ({
    name: `Tone ${id}`,
    participantId: id,
    consentStatus: id === "S03" ? "declined" : "granted",
  }));
  expect((await page.request.post(`/api/roster?examId=${examId}`, { data: roster })).ok()).toBe(
    true,
  );

  await page.goto("/import/session");
  // Pair files mode takes the manifest and the pair WAVs, and nothing else.
  await expect(page.locator('main input[type="file"]')).toHaveCount(2);
  await expect(page.getByRole("radio", { name: "Pair files" })).toBeChecked();
  await page.getByLabel("Exam id").fill(examId);
  await page.getByRole("button", { name: "Check exam" }).click();
  await page.getByLabel("Exam title").fill("Synthetic midterm");
  await page.getByLabel("Exam duration in minutes").fill("5");
  await page.getByRole("button", { name: "Create exam" }).click();
  await expect(page.getByTestId("exam-found")).toContainText("5 minutes");
  await page.getByLabel("Session label").fill(label);
  await page.getByLabel("Session label").blur();
  await page.getByLabel("Session date").fill("2026-10-19");

  await page.getByLabel("Pair manifest CSV").setInputFiles({
    name: `${label}_manifest.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from(fx.manifest),
  });
  await expect(page.getByTestId("manifest-loaded")).toContainText("3 rows");

  // An extra file in the folder blocks the upload.
  const blocked = page.getByTestId("upload-blocked");
  const stray = { name: "notes.wav", bytes: fx.files[0].bytes };
  await page.getByLabel("Pair WAV files").setInputFiles([...fx.files, stray].map(wav));
  await expect(blocked).toContainText(
    "The chosen file notes.wav matches no manifest row. Choose the pair files again without it",
  );
  await expect(page.getByTestId("extra-files")).toContainText("notes.wav");

  // A missing file blocks it too, and the table marks the row.
  await page.getByLabel("Pair WAV files").setInputFiles([fx.files[0], fx.files[2]].map(wav));
  await expect(blocked).toContainText(
    `Manifest row 2 names ${label}.02.Audio 1.wav, and no chosen file has that name.`,
  );
  await expect(page.getByTestId("pair-row-2").getByTestId("pair-file")).toContainText("missing");

  // All three, handed over in reverse, match by name.
  await page.getByLabel("Pair WAV files").setInputFiles([...fx.files].reverse().map(wav));
  const row1 = page.getByTestId("pair-row-1");
  await expect(row1.getByTestId("pair-file")).toHaveText(`${label}.01.Audio 2.wav`);
  await expect(row1.getByTestId("pair-duration")).toHaveText("0:02.500");
  await expect(row1.getByTestId("pair-left")).toHaveText("S01Tone S01");
  await expect(page.getByTestId("pair-row-2").getByTestId("pair-right")).toHaveText("S03Tone S03");
  await expect(page.getByTestId("pair-row-2").getByTestId("consent-excluded")).toHaveText(
    "excluded: consent (S03 declined)",
  );

  await expect(blocked).toHaveText(/Check the table, then tick the box that confirms it\./);
  await expect(page.getByRole("button", { name: "Upload pairs" })).toBeDisabled();
  await page.getByLabel("The table is correct").check();
  await expect(blocked).toHaveCount(0);
  await expectDescriptiveText(page);

  await page.getByRole("button", { name: "Upload pairs" }).click();
  await expect(page.getByTestId("upload-done")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("upload-files").getByTestId("upload-state")).toHaveText(
    Array(10).fill(/^done/),
  );
  await expect(page.getByRole("radio", { name: "Single session file" })).toBeDisabled();

  const get = (p: string) => page.request.get(`/api/file?pathname=${encodeURIComponent(p)}`);
  for (const [i, f] of fx.files.entries()) {
    const stored = await (await get(`audio/${label}-P0${i + 1}/stereo.wav`)).body();
    expect(sha(stored)).toBe(sha(f.bytes));
  }
  const p2 = await (await get(`sessions/${label}-P02.json`)).json();
  expect(p2.captureMode).toBe("file-import");
  expect(p2.participantIds).toEqual({ A: "S04", B: "S03" });
  expect(p2.excluded.reason).toBe("consent");
  expect(p2.source).toMatchObject({
    mode: "pair-file",
    fileName: `${label}.02.Audio 1.wav`,
    track: "Audio 1",
    fileSha256: sha(fx.files[1].bytes),
  });
  const imp = await (await get(`sessions-raw/${label}.json`)).json();
  expect(imp.mode).toBe("pair-file");
  expect(imp.manifestCsv).toBe(fx.manifest);

  await page.getByRole("button", { name: "Run pass two for all pairs" }).click();
  await expect(page.getByTestId(`pass2-${label}-P03`)).toContainText(": done", { timeout: 60_000 });
  await expect(page.getByTestId(`pass2-${label}-P01`)).toContainText(": done");
  await expect(page.getByTestId(`pass2-${label}-P02`)).toContainText("skipped, excluded: consent");

  await page.goto("/review");
  await expect(page.getByTestId(`group-${label}`)).toContainText("file import, 2026-10-19");
});
