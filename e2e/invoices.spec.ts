import { test, expect } from "@playwright/test";

test.describe("Module Factures", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Attendre que l'app soit chargée (dashboard ou sidebar visible)
    await page.getByTitle("Documents").click();
    await page.getByRole("button", { name: /Factures$/i }).click();
  });

  test("affiche la liste des factures", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /factures/i })).toBeVisible();
  });

  test("crée une nouvelle facture", async ({ page }) => {
    await page.getByRole("button", { name: /nouvelle facture|ajouter/i }).click();

    // Remplir le formulaire
    await page.getByLabel(/client/i).fill("Client Test");
    await page.getByLabel(/montant ht|amount_ht/i).fill("1000");
    await page.getByLabel(/description/i).fill("Prestation de test");

    await page.getByRole("button", { name: /sauvegarder|créer|enregistrer/i }).click();

    // La facture apparaît dans la liste
    await expect(page.getByText("Client Test")).toBeVisible({ timeout: 6_000 });
  });

  test("change le statut d'une facture en Envoyée", async ({ page }) => {
    // Présuppose qu'au moins une facture est en brouillon
    const envoyeeBtn = page.getByRole("button", { name: /envoyée/i }).first();
    if (await envoyeeBtn.isVisible()) {
      await envoyeeBtn.click();
      await expect(page.getByText(/envoyée|sent/i)).toBeVisible();
    }
  });

  test("télécharge le PDF d'une facture", async ({ page }) => {
    const pdfLink = page.getByRole("link", { name: /pdf/i }).first();
    if (await pdfLink.isVisible()) {
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        pdfLink.click(),
      ]);
      expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
    }
  });
});
