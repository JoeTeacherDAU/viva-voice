// npm run import:roster -- --file <roster.json> --exam <id> [--base-url <url>]
// Sends the roster to POST /api/roster, as the setup page's Import roster JSON
// button does. It prints the entry count and never a name.

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { postRoster } from "@/lib/import/remote";
import { connect, loadEnv, PRODUCTION_URL } from "./app";

const { values } = parseArgs({
  options: {
    file: { type: "string" },
    exam: { type: "string" },
    "base-url": { type: "string" },
    "no-env-file": { type: "boolean" },
  },
});

async function main() {
  if (!values.file || !values.exam) {
    throw new Error(
      'Usage: npm run import:roster -- --file "<roster.json>" --exam <id>. The archive keeps one roster per exam, so the exam id is required.',
    );
  }
  loadEnv(!values["no-env-file"]);
  let body: unknown;
  try {
    body = JSON.parse(readFileSync(values.file, "utf8"));
  } catch {
    throw new Error(`${values.file} is not valid JSON.`);
  }
  const app = await connect(values["base-url"] ?? process.env.VIVA_BASE_URL ?? PRODUCTION_URL);
  const entries = await postRoster(app.fetch, values.exam, body);
  console.log(`Imported the roster for exam ${values.exam} at ${app.baseUrl}: ${entries} entries.`);
}

main().catch((e) => {
  console.error(`Import failed: ${(e as Error).message}`);
  process.exit(1);
});
