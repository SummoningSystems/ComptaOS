import { test, expect } from "@playwright/test";

test("enregistre puis ventile la TVA d'une transaction bancaire", async ({ page, request }) => {
  const id = `txn_vat_meal_${Date.now()}`;
  const label = `REPAS MULTI TVA ${id}`;
  const transaction = {
    id,
    date: "2026-08-04",
    label,
    amount_ht: -30,
    vat: 0,
    vat_rate: 0,
    amount_ttc: -30,
    currency: "EUR",
    category: "restaurant",
    account: "PSD2",
    status: "pending",
  };

  const created = await request.post("http://127.0.0.1:3001/api/transactions", { data: transaction });
  expect(created.ok()).toBeTruthy();

  await page.goto("/");
  await page.getByRole("button", { name: /Transactions$/i }).click();
  await page.getByRole("button", { name: /2026.*transaction/i }).click();
  await page.getByRole("button", { name: /Août.*op/i }).click();

  const row = page.getByRole("row").filter({ hasText: label });
  await expect(row).toBeVisible();

  const vatRate = row.getByLabel("Taux de TVA");
  await vatRate.fill("10");
  await vatRate.press("Enter");
  await expect(row.getByText("TVA enregistrée")).toBeVisible();

  let stored = await request.get("http://127.0.0.1:3001/api/transactions");
  let transactions = await stored.json();
  expect(transactions.find((item: { id: string }) => item.id === id)).toMatchObject({
    vat_rate: 10,
    amount_ht: -27.27,
    vat: -2.73,
  });

  await row.getByRole("button", { name: "Multi-TVA" }).click();
  const dialog = page.getByRole("dialog", { name: "Ventilation TVA" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Montant TTC ligne 1").fill("20");
  await dialog.getByRole("button", { name: "Solde" }).nth(1).click();
  await expect(dialog.getByText("Total équilibré")).toBeVisible();
  await dialog.getByRole("button", { name: "Enregistrer la TVA" }).click();
  await expect(row.getByText("Ventilation TVA enregistrée")).toBeVisible();
  await expect(row.getByRole("button", { name: "2 taux" })).toBeVisible();

  stored = await request.get("http://127.0.0.1:3001/api/transactions");
  transactions = await stored.json();
  expect(transactions.find((item: { id: string }) => item.id === id)).toMatchObject({
    vat_splits: [
      { rate: 10, amount_ttc: -20 },
      { rate: 20, amount_ttc: -10 },
    ],
    amount_ht: -26.51,
    vat: -3.49,
  });
});
