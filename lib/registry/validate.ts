import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import schema from "@/schemas/features.schema.json";
import type { Registry } from "./types";

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const check = ajv.compile(schema);

export class RegistryError extends Error {}

/**
 * Validates raw registry JSON against schemas/features.schema.json and checks
 * that every feature id appears once. Throws RegistryError on any problem.
 */
export function validateRegistry(raw: unknown): Registry {
  if (!check(raw)) {
    const detail = (check.errors ?? [])
      .map((e) => `${e.instancePath || "(root)"} ${e.message}`)
      .join("; ");
    throw new RegistryError(`features.json fails its schema: ${detail}`);
  }
  const reg = raw as unknown as Registry;
  const seen = new Set<string>();
  for (const f of reg.features) {
    if (seen.has(f.id)) throw new RegistryError(`features.json repeats the id ${f.id}`);
    seen.add(f.id);
  }
  return reg;
}
