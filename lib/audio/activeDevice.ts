import type { DeviceReport } from "./devices";
import type { SyntheticSource } from "./synthetic";

// Holds the open stream across client-side navigation from /setup to
// /session, so the session screen reuses it without a second permission prompt.
interface Active {
  stream: MediaStream;
  report: DeviceReport;
  synthetic: SyntheticSource | null;
}

let active: Active | null = null;

export function setActiveDevice(a: Active | null): void {
  active = a;
}

export function getActiveDevice(): Active | null {
  return active;
}
