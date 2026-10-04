import { expect, type Page } from "@playwright/test";
import { E2E_PASSWORD } from "../../playwright.config";

export async function login(page: Page): Promise<void> {
  const res = await page.request.post("/api/login", { data: { password: E2E_PASSWORD } });
  expect(res.ok()).toBe(true);
}
