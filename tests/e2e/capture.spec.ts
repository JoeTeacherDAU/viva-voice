import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { WaveFile } from "wavefile";
import { login } from "./helpers";

// build-plan P3 acceptance: a 60-second synthetic capture produces a WAV that
// a Node WAV parser reads as 48 kHz stereo 16-bit with the expected sample count.
test("a 60-second synthetic capture produces a valid 48 kHz stereo WAV", async ({ page }) => {
  test.setTimeout(150_000);
  await login(page);
  await page.goto("/dev/capture-test?seconds=60");
  await page.getByRole("button", { name: /Start 60 s synthetic capture/ }).click();
  await expect(page.getByTestId("capture-status")).toHaveText("recording");
  const link = page.getByTestId("wav-link");
  await expect(link).toBeVisible({ timeout: 100_000 });

  const download = await Promise.all([page.waitForEvent("download"), link.click()]).then(
    ([d]) => d,
  );
  const path = await download.path();
  const wav = new WaveFile(readFileSync(path));
  const fmt = wav.fmt as {
    numChannels: number;
    sampleRate: number;
    bitsPerSample: number;
    audioFormat: number;
  };
  expect(fmt.audioFormat).toBe(1);
  expect(fmt.numChannels).toBe(2);
  expect(fmt.sampleRate).toBe(48000);
  expect(fmt.bitsPerSample).toBe(16);
  const samples = wav.getSamples(false, Int16Array) as unknown as Int16Array[];
  expect(samples).toHaveLength(2);
  expect(samples[0].length).toBe(60 * 48000);
  expect(samples[1].length).toBe(60 * 48000);
  // Both channels carry signal: the synthetic tones play throughout.
  const peak = (s: Int16Array) => s.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  expect(peak(samples[0])).toBeGreaterThan(5000);
  expect(peak(samples[1])).toBeGreaterThan(5000);
});
