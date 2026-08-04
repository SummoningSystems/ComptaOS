import { expect, test } from "@playwright/test";

test("pilote un frais annuel et simule sa réduction", async ({ page }) => {
  const label = `Assurance annuelle recette ${Date.now()}`;
  const nextYear = new Date().getFullYear() + 1;

  await page.goto("/");
  await page.getByTitle("Finance").click();
  await page.getByRole("button", { name: /Frais récurrents/i }).click();
  await expect(page.getByRole("heading", { name: /Pilotage des frais récurrents/i })).toBeVisible();

  await page.getByRole("button", { name: /Ajouter un frais/i }).click();
  await page.getByLabel("Libellé").fill(label);
  await page.getByLabel("Montant TTC").fill("1200");
  await page.getByLabel("Fréquence").selectOption("annuel");
  await page.getByLabel("Prochaine échéance").fill(`${nextYear}-01-31`);
  await page.getByLabel("Catégorie").selectOption("insurance");
  await page.getByRole("button", { name: "Enregistrer" }).click();

  const row = page.getByRole("row").filter({ hasText: label });
  await expect(row).toContainText("100 €/mois");
  await row.locator("select").selectOption("reduce");
  await row.locator('input[type="number"]').fill("600");
  await expect(row).toContainText("50 €/mois");
  await expect(page.getByText(/600.*économisés|Économie simulée/i).first()).toBeVisible();

  await page.getByRole("button", { name: /Calendrier prévisionnel/i }).click();
  await expect(page.getByText(/Coût structurel simulé/i)).toBeVisible();
});
