// Device discovery and the exact constraint set from PLAN.md section 5.

export interface AudioInputInfo {
  deviceId: string;
  label: string;
  /** Maximum channel count from getCapabilities(), when the probe ran. */
  channelCount?: number;
}

export interface CaptureSettings {
  channelCount?: number;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  sampleRate?: number;
}

export interface DeviceReport {
  deviceId: string;
  label: string;
  settings: CaptureSettings;
  synthetic: boolean;
  /** Reasons the session must not start. Empty means the device passes. */
  blocking: string[];
}

export function captureConstraints(deviceId: string): MediaStreamConstraints {
  return {
    audio: {
      deviceId: { exact: deviceId },
      channelCount: 2,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      sampleRate: 48000,
    },
    video: false,
  };
}

/** PLAN.md section 5: block when any processing flag is on or fewer than two channels. */
export function blockingReasons(s: CaptureSettings): string[] {
  const out: string[] = [];
  if ((s.channelCount ?? 1) < 2) {
    out.push(
      `The device delivers ${s.channelCount ?? "an unknown number of"} channel(s). Viva Voice needs two, one per student. Check that the receiver is in Stereo mode.`,
    );
  }
  if (s.echoCancellation) out.push("Echo cancellation is on. The browser must turn it off.");
  if (s.noiseSuppression) out.push("Noise suppression is on. The browser must turn it off.");
  if (s.autoGainControl) out.push("Automatic gain control is on. The browser must turn it off.");
  if (s.sampleRate !== undefined && s.sampleRate !== 48000) {
    out.push(`The device runs at ${s.sampleRate} Hz. Viva Voice expects 48000 Hz.`);
  }
  return out;
}

/** Lists audio inputs. Labels appear only after the page holds mic permission. */
export async function listAudioInputs(): Promise<AudioInputInfo[]> {
  const all = await navigator.mediaDevices.enumerateDevices();
  return all
    .filter(
      (d) => d.kind === "audioinput" && d.deviceId !== "default" && d.deviceId !== "communications",
    )
    .map((d) => ({ deviceId: d.deviceId, label: d.label || "Unnamed input" }));
}

/**
 * Asks for microphone permission once so enumerateDevices returns labels.
 * Skips the prompt when labels already show, and gives up after timeoutMs
 * rather than leaving the setup screen waiting on a prompt nobody answers.
 */
export async function primePermission(timeoutMs = 10000): Promise<void> {
  const known = await navigator.mediaDevices.enumerateDevices();
  if (known.some((d) => d.kind === "audioinput" && d.label)) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("the microphone permission prompt timed out")),
      timeoutMs,
    );
  });
  try {
    const s = await Promise.race([navigator.mediaDevices.getUserMedia({ audio: true }), timeout]);
    s.getTracks().forEach((t) => t.stop());
  } finally {
    clearTimeout(timer);
  }
}

export async function openDevice(
  deviceId: string,
): Promise<{ stream: MediaStream; report: DeviceReport }> {
  const stream = await navigator.mediaDevices.getUserMedia(captureConstraints(deviceId));
  const track = stream.getAudioTracks()[0];
  const s = track.getSettings() as MediaTrackSettings & CaptureSettings;
  const settings: CaptureSettings = {
    channelCount: s.channelCount,
    echoCancellation: s.echoCancellation,
    noiseSuppression: s.noiseSuppression,
    autoGainControl: s.autoGainControl,
    sampleRate: s.sampleRate,
  };
  return {
    stream,
    report: {
      deviceId,
      label: track.label,
      settings,
      synthetic: false,
      blocking: blockingReasons(settings),
    },
  };
}

/** docs/rulings.md R5: Chrome only. Chromium counts, for headless tests. */
export function browserBlock(uaData?: { brands?: { brand: string }[] }, ua = ""): string | null {
  const brands = (uaData?.brands ?? []).map((b) => b.brand);
  const chrome =
    brands.includes("Google Chrome") || brands.includes("Chromium") || /HeadlessChrome/.test(ua);
  const other = brands.some((b) => /Edge|Opera|Brave/i.test(b));
  return chrome && !other
    ? null
    : "Viva Voice runs in Google Chrome only (ruling R5). Open this page in Chrome.";
}
