import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { makePairFixture } from "../../lib/import/synthetic";
import { E2E_PASSWORD } from "../../playwright.config";
import { login } from "./helpers";

const run = promisify(execFile);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/**
 * Runs an import command against the e2e server. It skips .env.local and
 * blanks the Blob token, so it can only reach the server's in-memory store.
 */
async function cli(script: string, args: string[], baseURL: string) {
  try {
    const out = await run(
      "node",
      ["scripts/run-ts.mjs", script, ...args, "--base-url", baseURL, "--no-env-file"],
      {
        env: { ...process.env, VIVA_PASSWORD: E2E_PASSWORD, BLOB_READ_WRITE_TOKEN: "" },
      },
    );
    return { code: 0, stdout: out.stdout, stderr: out.stderr };
  } catch (e) {
    const x = e as { code: number; stdout: string; stderr: string };
    return { code: x.code, stdout: x.stdout, stderr: x.stderr };
  }
}

// Work order 04: the command-line import, end to end, on a synthetic folder.
test("command-line import: roster, session folder, pass two, and a safe re-run", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const id = Date.now().toString(36);
  const examId = `e2e-cli-${id}`;
  const label = `E2E_CLI_${id}`;
  const fx = makePairFixture(label);
  const dir = mkdtempSync(join(tmpdir(), "viva-cli-"));
  const folder = join(dir, label);
  mkdirSync(folder);
  writeFileSync(join(folder, `${label}_manifest.csv`), fx.manifest);
  for (const f of fx.files) writeFileSync(join(folder, f.name), f.bytes);
  const rosterFile = join(dir, "roster.json");
  writeFileSync(
    rosterFile,
    JSON.stringify(
      ["S01", "S02", "S03", "S04", "S05", "S06"].map((p) => ({
        name: `Hidden Name ${p}`,
        participantId: p,
        consentStatus: p === "S03" ? "declined" : "granted",
      })),
    ),
  );

  const roster = await cli(
    "scripts/cli/import-roster.ts",
    ["--file", rosterFile, "--exam", examId],
    baseURL!,
  );
  expect(roster.code, roster.stderr).toBe(0);
  expect(roster.stdout).toContain(`Imported the roster for exam ${examId}`);
  expect(roster.stdout).toContain("6 entries");

  const args = ["--folder", folder, "--exam", examId, "--date", "2026-10-19"];
  const noTitle = await cli("scripts/cli/import-session.ts", args, baseURL!);
  expect(noTitle.code).toBe(1);
  expect(noTitle.stderr).toContain(`The archive has no exam ${examId}. Pass --title`);

  const withTitle = [...args, "--title", "Synthetic midterm", "--duration-min", "5"];
  const first = await cli("scripts/cli/import-session.ts", withTitle, baseURL!);
  expect(first.code, first.stderr).toBe(0);
  expect(first.stdout.trim().split("\n")).toEqual([
    ...[
      `${label}.01.Audio 2.wav | left S01 | right S02 | upload: uploaded | pass two: done`,
      `${label}.02.Audio 1.wav | left S04 | right S03 | upload: uploaded | pass two: skipped, excluded: consent`,
      `${label}.03.Audio 3.wav | left S05 | right S06 | upload: uploaded | pass two: done`,
    ],
    `Outputs: saved 4 DOCX, 3 CSV, and ${label}.zip in ${join(folder, "outputs")}`,
  ]);
  expect(readdirSync(join(folder, "outputs")).sort()).toEqual(
    [
      `${label}.zip`,
      `${label}-P01-A-S01.docx`,
      `${label}-P01-B-S02.docx`,
      `${label}-P03-A-S05.docx`,
      `${label}-P03-B-S06.docx`,
      `${label}-wide.csv`,
      `${label}-long.csv`,
      `${label}-pairs.csv`,
    ].sort(),
  );
  expect(first.stdout + first.stderr).not.toContain("Hidden Name");
  expect(first.stdout + first.stderr).not.toContain(E2E_PASSWORD);

  const again = await cli("scripts/cli/import-session.ts", withTitle, baseURL!);
  expect(again.code, again.stderr).toBe(0);
  expect(again.stdout).toContain(
    `${label}.01.Audio 2.wav | left S01 | right S02 | upload: skipped, already uploaded with the same file hash | pass two: skipped, already done`,
  );

  // The archive holds what the page would have written.
  await login(page);
  const get = (p: string) => page.request.get(`/api/file?pathname=${encodeURIComponent(p)}`);
  for (const [i, f] of fx.files.entries()) {
    const stored = await (await get(`audio/${label}-P0${i + 1}/stereo.wav`)).body();
    expect(sha(stored)).toBe(sha(f.bytes));
  }
  const p1 = await (await get(`sessions/${label}-P01.json`)).json();
  expect(p1.captureMode).toBe("file-import");
  expect(p1.source).toMatchObject({ mode: "pair-file", fileName: `${label}.01.Audio 2.wav` });
  expect(p1.passes["2"]).toBeTruthy();
  const imp = await (await get(`sessions-raw/${label}.json`)).json();
  expect(imp.manifestCsv).toBe(fx.manifest);

  await page.goto("/review");
  await expect(page.getByTestId(`group-${label}`)).toContainText("file import, 2026-10-19");
});
