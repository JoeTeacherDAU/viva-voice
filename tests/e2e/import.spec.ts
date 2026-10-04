import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { login } from "./helpers";

const FX = join(__dirname, "../../fixtures/golden/balanced");
const ID = "fixture-balanced";

/** Minimal mono WAV writer: 16-bit PCM or 32-bit float. */
function monoWav(samples: Float32Array, float: boolean): Buffer {
  const bytes = float ? 4 : 2;
  const b = Buffer.alloc(44 + samples.length * bytes);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + samples.length * bytes, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(float ? 3 : 1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(48000, 24);
  b.writeUInt32LE(48000 * bytes, 28);
  b.writeUInt16LE(bytes, 32);
  b.writeUInt16LE(bytes * 8, 34);
  b.write("data", 36);
  b.writeUInt32LE(samples.length * bytes, 40);
  samples.forEach((x, i) =>
    float
      ? b.writeFloatLE(x, 44 + i * 4)
      : b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x)) * 32767), 44 + i * 2),
  );
  return b;
}

/** One fixture channel, shifted so its sample 0 sits at offsetMs on the archive timeline. */
function onboardTrack(ch: 0 | 1, offsetMs: number): Float32Array {
  const wav = readFileSync(join(FX, "stereo.wav"));
  const frames = (wav.length - 44) / 4;
  const src = Float32Array.from(
    { length: frames },
    (_, i) => wav.readInt16LE(44 + i * 4 + ch * 2) / 32768,
  );
  const k = Math.round((Math.abs(offsetMs) * 48000) / 1000);
  if (offsetMs >= 0) return src.slice(k);
  const out = new Float32Array(src.length + k);
  out.set(src, k);
  return out;
}

// build-plan P7 acceptance: the import page aligns two synthetic mono WAVs to
// the fixture stereo within 20 ms.
test("onboard import aligns two mono WAVs within 20 ms and runs pass two on them", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await login(page);

  // Seed the balanced fixture as an archived session in the in-memory store.
  const put = async (pathname: string, body: Buffer | string, type: string) => {
    const r = await page.request.put(`/api/upload?pathname=${encodeURIComponent(pathname)}`, {
      data: body,
      headers: { "content-type": type },
    });
    expect(r.ok(), `seeding ${pathname}`).toBe(true);
  };
  await put(`audio/${ID}/stereo.wav`, readFileSync(join(FX, "stereo.wav")), "audio/wav");
  await put(`energy/${ID}.json`, readFileSync(join(FX, "energy.json")), "application/json");
  await put(
    `transcripts/${ID}/pass1.json`,
    JSON.stringify({ words: JSON.parse(readFileSync(join(FX, "words.json"), "utf8")) }),
    "application/json",
  );
  await put(
    `measurements/${ID}/pass1.json`,
    JSON.stringify({ pipelineVersion: "1.0.0", pass: 1, features: [] }),
    "application/json",
  );
  await put(`sessions/${ID}.json`, readFileSync(join(FX, "session.json")), "application/json");

  await page.goto(`/import?id=${ID}`);
  await page.getByLabel("Onboard WAV for student A").setInputFiles({
    name: "onboard-A.wav",
    mimeType: "audio/wav",
    buffer: monoWav(onboardTrack(0, -3217), true),
  });
  await page.getByLabel("Onboard WAV for student B").setInputFiles({
    name: "onboard-B.wav",
    mimeType: "audio/wav",
    buffer: monoWav(onboardTrack(1, 1500), false),
  });
  await page.getByRole("button", { name: "Align", exact: true }).click();
  await expect(page.getByTestId("offset-A")).toBeVisible({ timeout: 30_000 });
  const a = Number(await page.getByTestId("offset-A").innerText());
  const b = Number(await page.getByTestId("offset-B").innerText());
  expect(Math.abs(a - -3217)).toBeLessThanOrEqual(20);
  expect(Math.abs(b - 1500)).toBeLessThanOrEqual(20);

  await page.getByRole("button", { name: "Upload aligned audio" }).click();
  await expect(page.getByTestId("import-uploaded")).toBeVisible({ timeout: 30_000 });
  const wav = await page.request.get(
    `/api/file?pathname=${encodeURIComponent(`audio/${ID}/onboard-stereo.wav`)}`,
  );
  expect(wav.ok()).toBe(true);
  const body = await wav.body();
  expect(body.toString("ascii", 0, 4)).toBe("RIFF");
  expect(body.readUInt16LE(22)).toBe(2);
  // The whole file arrived: the data chunk size matches the bytes stored.
  expect(body.readUInt32LE(40)).toBe(body.length - 44);
  expect(body.length - 44).toBe(63 * 48000 * 4);
  const seeded = await (
    await page.request.get(`/api/file?pathname=${encodeURIComponent(`audio/${ID}/stereo.wav`)}`)
  ).body();
  expect(seeded.length).toBe(readFileSync(join(FX, "stereo.wav")).length);

  await page.getByRole("button", { name: "Run pass two (onboard)" }).click();
  await expect(page.getByTestId("import-status")).toHaveText(
    "Pass two finished. Session state: done.",
    { timeout: 30_000 },
  );
  const rec = await (
    await page.request.get(`/api/file?pathname=${encodeURIComponent(`sessions/${ID}.json`)}`)
  ).json();
  expect(rec.passes["2"].source).toBe("onboard");
});
