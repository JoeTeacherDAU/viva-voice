import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("setup reaches a passing state on the synthetic stereo device", async ({ page }) => {
  await page.goto("/setup?calSeconds=1");
  await page.getByRole("button", { name: "Find devices" }).click();
  await page.getByLabel("Input device").selectOption({ label: "Synthetic stereo (test)" });
  await page.getByRole("button", { name: "Open device" }).click();
  await expect(page.getByTestId("device-report")).toContainText("2 channel(s)");

  await page.getByRole("button", { name: "Calibrate student A" }).click();
  await expect(page.getByRole("button", { name: "Calibrate student B" })).toBeEnabled({
    timeout: 5000,
  });
  await page.getByRole("button", { name: "Calibrate student B" }).click();
  await expect(page.getByTestId("calibration-result")).not.toContainText("not measured", {
    timeout: 5000,
  });
  // The synthetic bleed sits 20 dB below the wearer.
  await expect(page.getByTestId("calibration-result")).toContainText(
    /Separation A: (19|20|21)\.\d dB/,
  );

  await page.getByLabel("Student A", { exact: true }).selectOption("DEMO-001");
  await page.getByLabel("Student B", { exact: true }).selectOption("DEMO-002");
  await expect(page.getByTestId("setup-ready")).toBeVisible();

  await page.getByRole("button", { name: "Continue to session" }).click();
  await expect(page).toHaveURL(/\/session\?id=demo-exam-/);
  await expect(page.getByTestId("session-state")).toHaveText("State: setup");
});

test("a declined student blocks the session", async ({ page }) => {
  await page.goto("/setup");
  await page.getByLabel("Student A", { exact: true }).selectOption("DEMO-001");
  await page.getByLabel("Student B", { exact: true }).selectOption("DEMO-004");
  await expect(page.getByTestId("blocking").filter({ hasText: "consented" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to session" })).toBeDisabled();
});

test("a mono fake device shows the channel-count block", async ({ page }) => {
  // On macOS, Chromium asks the operating system for microphone permission even
  // for the fake device, and headless mode cannot answer that prompt, so
  // getUserMedia never resolves. GitHub Actions runs this test on Linux.
  test.skip(
    process.platform === "darwin",
    "macOS blocks headless fake-microphone capture; CI on Linux runs this test",
  );
  await page.goto("/setup");
  await page.getByRole("button", { name: "Find devices" }).click();
  const select = page.getByLabel("Input device");
  // The synthetic entry appears when the device lookup finishes.
  await expect(select.locator("option", { hasText: "Synthetic stereo (test)" })).toHaveCount(1);
  const options = await select.locator("option").allTextContents();
  const fake = options.find((o) => o && o !== "Choose a device" && !o.startsWith("Synthetic"));
  expect(fake, `fake devices: ${options.join(", ")}`).toBeTruthy();
  await select.selectOption({ label: fake! });
  await page.getByRole("button", { name: "Open device" }).click();
  await expect(page.getByTestId("device-report")).toContainText("1 channel(s)");
  await expect(page.getByTestId("blocking").filter({ hasText: "needs two" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to session" })).toBeDisabled();
});
