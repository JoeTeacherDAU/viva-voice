import { zipSync, type Zippable } from "fflate";

/**
 * Zips a session's evidence (build-plan P6.7). WAV and DOCX are already
 * dense or compressed, so they go in stored; JSON gets deflated.
 */
export function buildBundle(files: Record<string, Uint8Array>): Uint8Array {
  const z: Zippable = {};
  for (const [name, bytes] of Object.entries(files)) {
    z[name] = [bytes, { level: /\.(wav|docx|zip)$/.test(name) ? 0 : 6 }];
  }
  return zipSync(z);
}
