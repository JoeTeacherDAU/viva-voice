import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import sessionSchema from "@/schemas/session.schema.json";
import wordsSchema from "@/schemas/words.schema.json";
import examSchema from "@/schemas/exam.schema.json";
import rosterSchema from "@/schemas/roster.schema.json";
import type { SessionRecord, Word } from "@/lib/analysis/types";

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const checkSession = ajv.compile(sessionSchema);
const checkWords = ajv.compile(wordsSchema);
const checkExam = ajv.compile(examSchema);
const checkRoster = ajv.compile(rosterSchema);

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

function result(ok: boolean, errs: typeof checkSession.errors): ValidationResult {
  return {
    ok,
    errors: (errs ?? []).map((e) => `${e.instancePath || "(root)"} ${e.message}`),
  };
}

export function validateSession(data: unknown): ValidationResult {
  return result(checkSession(data), checkSession.errors);
}

export function validateWords(data: unknown): ValidationResult {
  return result(checkWords(data), checkWords.errors);
}

export function assertSession(data: unknown): SessionRecord {
  const r = validateSession(data);
  if (!r.ok) throw new Error(`Invalid session record: ${r.errors.join("; ")}`);
  return data as SessionRecord;
}

export function assertWords(data: unknown): Word[] {
  const r = validateWords(data);
  if (!r.ok) throw new Error(`Invalid word list: ${r.errors.join("; ")}`);
  return data as Word[];
}

export function validateExam(data: unknown): ValidationResult {
  return result(checkExam(data), checkExam.errors);
}

export function validateRoster(data: unknown): ValidationResult {
  const r = result(checkRoster(data), checkRoster.errors);
  if (r.ok) {
    const ids = (data as { participantId: string }[]).map((e) => e.participantId);
    if (new Set(ids).size !== ids.length) return { ok: false, errors: ["participant ids repeat"] };
  }
  return r;
}
