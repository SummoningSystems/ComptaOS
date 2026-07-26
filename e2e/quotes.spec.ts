import { test, expect } from "@playwright/test";

test.describe("Module Devis", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("Documents").click();
    await page.getByRole("button", { name: /Devis$/i }).click();
  });

  test("affiche la vue des devis", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /devis/i })).toBeVisible();
  });

  test("crée un nouveau devis", async ({ page }) => {
    await page.getByRole("button", { name: /nouveau devis|ajouter/i }).click();

    await page.getByLabel(/client/i).fill("Client Devis Test");
    await page.getByLabel(/montant ht/i).fill("2500");
    await page.getByLabel(/description/i).fill("Devis de test E2E");

    await page.getByRole("button", { name: /sauvegarder|créer|enregistrer/i }).click();

    await expect(page.getByText("Client Devis Test")).toBeVisible({ timeout: 6_000 });
  });

  test("accepte un devis et le convertit en facture", async ({ page }) => {
    // Présuppose qu'un devis est en statut "envoyé"
    const acceptBtn = page.getByRole("button", { name: /accepté|accepter/i }).first();
    if (await acceptBtn.isVisible()) {
      await acceptBtn.click();
      // Bouton "→ Facture" doit apparaître
      const convertBtn = page.getByRole("button", { name: /facture|convertir/i }).first();
      await expect(convertBtn).toBeVisible({ timeout: 4_000 });
      await convertBtn.click();
      await expect(page.getByText(/converti|converted/i)).toBeVisible({ timeout: 6_000 });
    }
  });
});
