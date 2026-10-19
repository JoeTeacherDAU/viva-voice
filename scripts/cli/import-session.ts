// npm run import:session -- --folder <path> --exam <id> --date <YYYY-MM-DD>
//   [--title <text> --duration-min <n>] [--base-url <url>]
// Imports one session folder (one manifest CSV and its pair WAVs) through
// lib/import/folderImport.ts, then runs pass two through the app's route, so
// the Deepgram key stays in Vercel, and saves the outputs into <folder>/outputs/.
// The session label is the folder name.

import { mkdirSync, openAsBlob, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { formatPairLine, FolderImportStop, importSessionFolder } from "@/lib/import/folderImport";
import { connect, loadEnv, PRODUCTION_URL } from "./app";

const { values } = parseArgs({
  options: {
    folder: { type: "string" },
    exam: { type: "string" },
    date: { type: "string" },
    title: { type: "string" },
    "duration-min": { type: "string" },
    "base-url": { type: "string" },
    "no-env-file": { type: "boolean" },
  },
});

async function main(): Promise<number> {
  if (!values.folder || !values.exam || !values.date) {
    throw new FolderImportStop(
      'Usage: npm run import:session -- --folder "<path>" --exam <id> --date <YYYY-MM-DD> [--title "<title>" --duration-min <n>]',
    );
  }
  loadEnv(!values["no-env-file"]);
  const folder = resolve(values.folder.replace(/\/+$/, ""));
  const names = readdirSync(folder).filter((n) => !n.startsWith("."));
  const csvs = names.filter((n) => n.toLowerCase().endsWith(".csv"));
  if (csvs.length !== 1) {
    throw new FolderImportStop(
      `The folder must hold exactly one manifest CSV; it holds ${csvs.length}${csvs.length ? `: ${csvs.join(", ")}` : ""}.`,
    );
  }
  const wavs = await Promise.all(
    names
      .filter((n) => n.toLowerCase().endsWith(".wav"))
      .map(async (name) => ({ name, blob: await openAsBlob(join(folder, name)) })),
  );

  const app = await connect(values["base-url"] ?? process.env.VIVA_BASE_URL ?? PRODUCTION_URL);
  console.error(`Connected to ${app.baseUrl} (${app.mode} store).`);
  const outDir = join(folder, "outputs");
  const { lines, ok, outputs, outputsError } = await importSessionFolder(
    {
      sessionLabel: basename(folder),
      examId: values.exam,
      sessionDate: values.date,
      title: values.title,
      durationMin: values["duration-min"] ? Number(values["duration-min"]) : undefined,
      manifest: { fileName: csvs[0], text: readFileSync(join(folder, csvs[0]), "utf8") },
      wavs,
    },
    {
      fetch: app.fetch,
      upload: app.upload,
      uploaderHas: app.uploaderHas,
      saveOutput: async (name, bytes) => {
        mkdirSync(outDir, { recursive: true });
        writeFileSync(join(outDir, basename(name)), bytes);
      },
      log: (l) => console.error(l),
    },
  );
  for (const l of lines) console.log(formatPairLine(l));
  const docx = outputs.filter((n) => n.endsWith(".docx")).length;
  const csv = outputs.filter((n) => n.endsWith(".csv")).length;
  console.log(
    outputsError
      ? `Outputs: ${outputsError}`
      : `Outputs: saved ${docx} DOCX, ${csv} CSV, and ${basename(folder)}.zip in ${outDir}`,
  );
  return ok ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    const stop = e instanceof FolderImportStop;
    console.error(
      stop
        ? `Stopped. Nothing was uploaded.\n${e.message}`
        : `Import failed: ${(e as Error).message}`,
    );
    process.exit(1);
  },
);
