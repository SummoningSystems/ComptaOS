import { test, expect } from "@playwright/test";

test.describe("Paramètres — profil entreprise", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("Outils").click();
    await page.getByRole("button", { name: /Param/i }).click();
  });

  test("affiche le formulaire de profil entreprise", async ({ page }) => {
    await expect(page.getByText(/profil de l'entreprise/i)).toBeVisible();
  });

  test("sauvegarde le profil entreprise", async ({ page }) => {
    // Remplir quelques champs
    const nomField = page.getByLabel(/nom de l'entreprise/i).first();
    await nomField.clear();
    await nomField.fill("Ma Société Modifiée");

    const emailField = page.getByLabel(/email/i).first();
    await emailField.clear();
    await emailField.fill("contact@masociete.fr");

    await page.getByRole("button", { name: /sauvegarder le profil/i }).click();

    // Toast ou confirmation visible
    await expect(page.getByText(/sauvegardé|profil mis à jour|enregistré/i)).toBeVisible({
      timeout: 6_000,
    });
  });
});
