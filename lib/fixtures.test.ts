import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateSession, validateWords } from "./validation";

const dir = (name: string) => join(__dirname, "..", "fixtures", "golden", name);
const load = (name: string, file: string) =>
  JSON.parse(readFileSync(join(dir(name), file), "utf8")) as unknown;

describe.each(["balanced", "asymmetric", "gappy"])("fixture %s", (name) => {
  it("has a session record that passes the schema", () => {
    expect(validateSession(load(name, "session.json")).errors).toEqual([]);
  });
  it("has a word list that passes the schema", () => {
    expect(validateWords(load(name, "words.json")).errors).toEqual([]);
  });
  it("has energy frames covering the WAV on both channels", () => {
    const e = load(name, "energy.json") as { frameMs: number; channels: number[][] };
    const wavBytes = readFileSync(join(dir(name), "stereo.wav")).length - 44;
    const frames = wavBytes / 4 / (48000 * (e.frameMs / 1000));
    expect(e.channels[0]).toHaveLength(frames);
    expect(e.channels[1]).toHaveLength(frames);
  });
});
