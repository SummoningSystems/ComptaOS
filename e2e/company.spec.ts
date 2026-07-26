import { test, expect } from "@playwright/test";

test.describe("Wizard création entreprise", () => {
  test("peut créer une entreprise supplémentaire et atteindre le dashboard", async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("Changer d'entreprise").click();
    await page.getByRole("button", { name: /nouvelle entreprise/i }).click();

    await expect(page.getByRole("heading", { name: "Nouvelle entreprise" })).toBeVisible();
    await page.getByPlaceholder("Ma Société SAS").fill("Test SARL");
    await page.getByRole("button", { name: /créer l'entreprise/i }).click();

    await page.getByRole("button", { name: /passer cette étape/i }).click();

    await expect(page.getByRole("heading", { name: /Test SARL est prête/i })).toBeVisible({ timeout: 8_000 });
    await page.getByRole("button", { name: /accéder au dashboard/i }).click();

    await expect(page.getByText(/dashboard|tableau de bord/i).first()).toBeVisible({ timeout: 8_000 });
  });
});
