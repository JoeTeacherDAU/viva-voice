import { expect, type Page } from "@playwright/test";
import { E2E_PASSWORD } from "../../playwright.config";

export async function login(page: Page): Promise<void> {
  const res = await page.request.post("/api/login", { data: { password: E2E_PASSWORD } });
  expect(res.ok()).toBe(true);
}

/** Runs the setup screen on the synthetic stereo device and lands on /session. Returns the session id. */
export async function setupSyntheticSession(page: Page): Promise<string> {
  await page.goto("/setup");
  await page.getByRole("button", { name: "Find devices" }).click();
  await page.getByLabel("Input device").selectOption({ label: "Synthetic stereo (test)" });
  await page.getByRole("button", { name: "Open device" }).click();
  await expect(page.getByTestId("device-report")).toContainText("2 channel(s)");
  await page.getByLabel("Student A", { exact: true }).selectOption("DEMO-001");
  await page.getByLabel("Student B", { exact: true }).selectOption("DEMO-002");
  await page.getByRole("button", { name: "Continue to session" }).click();
  await expect(page).toHaveURL(/\/session\?id=/);
  return new URL(page.url()).searchParams.get("id")!;
}

/** Reads a session record straight from the browser's IndexedDB. */
export async function readSessionRecord(page: Page, id: string) {
  return page.evaluate(
    (sid) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const req = indexedDB.open("viva");
        req.onsuccess = () => {
          const get = req.result.transaction("sessions").objectStore("sessions").get(sid);
          get.onsuccess = () => resolve(get.result);
          get.onerror = () => reject(get.error);
        };
        req.onerror = () => reject(req.error);
      }),
    id,
  );
}
