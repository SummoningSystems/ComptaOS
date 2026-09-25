import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const baseUrl = (process.env.PREPROD_URL ?? "https://tipforgood.com/comptaos-preprod/").replace(/\/?$/, "/");
const token = process.env.PREPROD_OWNER_TOKEN;
const output = path.resolve(process.env.PREPROD_ACCEPTANCE_OUTPUT ?? "artifacts/preproduction-acceptance");
assert(token, "PREPROD_OWNER_TOKEN est obligatoire.");
await fs.mkdir(output, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const loginContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "fr-FR" });
  const loginPage = await loginContext.newPage();
  const loginResponse = await loginPage.goto(baseUrl, { waitUntil: "networkidle" });
  assert.equal(loginResponse?.status(), 200);
  await loginPage.getByRole("button", { name: /connexion/i }).waitFor({ timeout: 15_000 });
  await loginPage.screenshot({ path: path.join(output, "desktop-login.png"), fullPage: true });
  await loginContext.close();

  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "fr-FR" });
  await desktop.addCookies([{ name: "comptaos_preprod_token", value: token, domain: "tipforgood.com", path: "/comptaos-preprod", secure: true, httpOnly: true, sameSite: "Lax" }]);
  const page = await desktop.newPage();
  await page.goto(`${baseUrl}?legacy=1`, { waitUntil: "networkidle" });
  await page.getByText("Transactions", { exact: true }).first().waitFor({ timeout: 20_000 });
  await page.screenshot({ path: path.join(output, "desktop-dashboard.png"), fullPage: true });
  await page.getByText("Transactions", { exact: true }).first().click();
  await page.getByText(/transactions/i).first().waitFor();
  await page.screenshot({ path: path.join(output, "desktop-transactions.png"), fullPage: true });
  await page.getByText("Clôture annuelle", { exact: true }).first().click();
  await page.getByText(/clôture annuelle/i).last().waitFor({ timeout: 20_000 });
  await page.screenshot({ path: path.join(output, "desktop-annual-closing.png"), fullPage: true });
  await desktop.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "fr-FR" });
  await mobile.addCookies([{ name: "comptaos_preprod_token", value: token, domain: "tipforgood.com", path: "/comptaos-preprod", secure: true, httpOnly: true, sameSite: "Lax" }]);
  const mobilePage = await mobile.newPage();
  await mobilePage.goto(`${baseUrl}?legacy=1`, { waitUntil: "networkidle" });
  await mobilePage.screenshot({ path: path.join(output, "mobile-capture.png"), fullPage: true });
  assert.equal(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, "Débordement horizontal mobile détecté.");
  await mobile.close();

  console.log(JSON.stringify({ ok: true, baseUrl, screenshots: 5, desktop: true, mobile: true }, null, 2));
} finally {
  await browser.close();
}
