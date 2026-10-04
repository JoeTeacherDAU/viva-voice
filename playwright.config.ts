import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

export const E2E_PASSWORD = "e2e-password";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices["Desktop Chrome"],
    // Full Chromium in new headless mode; the stripped headless shell never
    // resolves getUserMedia on the fake audio device.
    channel: "chromium",
    viewport: { width: 1280, height: 800 },
    permissions: ["microphone"],
    launchOptions: {
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
  },
  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
    env: {
      VIVA_MOCK_ASR: "1",
      VIVA_PASSWORD: E2E_PASSWORD,
      VIVA_SESSION_SECRET: "e2e-session-secret-0123456789abcdef",
    },
  },
});
