import { readFile } from "fs/promises";
import { test, expect } from "@playwright/test";

test.describe("Recette métier complète", () => {
  test("importe, catégorise, valide, facture puis exporte", async ({ page }) => {
    const year = new Date().getFullYear();
    const transactionLabel = `RECETTE LOGICIEL ${year}`;
    const clientName = `Client recette ${year}`;
    const csv = [
      "Date,Libellé,Montant",
      `${year}-07-15,${transactionLabel},-120.00`,
    ].join("\n");

    await page.goto("/");

    // 1. Import bancaire CSV avec le mapping automatique.
    await page.getByRole("button", { name: /Import CSV$/i }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "recette-comptaos.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf-8"),
    });
    await expect(page.getByText(transactionLabel)).toBeVisible();
    await page.getByRole("button", { name: /^Importer$/i }).click();
    await expect(page.getByText(/1 transaction.*import/i)).toBeVisible({ timeout: 10_000 });

    // 2. Catégorisation et validation depuis le grand livre.
    await page.getByRole("button", { name: /Transactions$/i }).click();
    await page.getByRole("button", { name: new RegExp(`${year}.*1 transaction`, "i") }).click();
    await page.getByRole("button", { name: /Juillet.*1 op/i }).click();
    const transactionRow = page.getByRole("row").filter({ hasText: transactionLabel });
    await expect(transactionRow).toBeVisible();
    const selects = transactionRow.locator("select");
    await selects.nth(0).selectOption("software");
    await selects.nth(1).selectOption("validated");
    await expect(selects.nth(0)).toHaveValue("software");
    await expect(selects.nth(1)).toHaveValue("validated");

    // 3. Création d'une facture métier.
    await page.getByTitle("Documents").click();
    await page.getByRole("button", { name: /Factures$/i }).click();
    await page.getByRole("button", { name: /nouvelle facture/i }).click();
    await page.getByLabel(/client/i).fill(clientName);
    await page.getByLabel(/montant ht/i).fill("500");
    await page.getByLabel(/description/i).fill("Prestation de recette ComptaOS");
    await page.getByRole("button", { name: /sauvegarder/i }).click();
    await expect(page.getByText(clientName)).toBeVisible({ timeout: 10_000 });

    // 4. Export du grand livre et vérification du contenu comptable.
    await page.getByTitle("Analyses & Export").click();
    await page.getByRole("button", { name: /Export$/i }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /télécharger CSV/i }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`compta_${year}.csv`);

    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    const exportedCsv = await readFile(downloadPath!, "utf-8");
    expect(exportedCsv).toContain(transactionLabel);
    expect(exportedCsv).toContain('"software"');
    expect(exportedCsv).toContain('"validated"');
  });
});
