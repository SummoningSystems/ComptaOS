import { test, expect } from "@playwright/test";

test("guide et bloque le rapprochement tant que la transaction est incomplete", async ({ page, request }) => {
  const suffix = Date.now();
  const blockedId = `txn_reconcile_blocked_${suffix}`;
  const readyId = `txn_reconcile_ready_${suffix}`;
  const date = new Date().toISOString().slice(0, 10);

  const base = {
    date,
    amount_ht: -20,
    vat: -2,
    vat_rate: 10,
    amount_ttc: -22,
    currency: "EUR",
    account: "PSD2",
    reconciled: false,
  };

  await request.post("http://127.0.0.1:3001/api/transactions", {
    data: { ...base, id: blockedId, label: `RAPPROCHEMENT INCOMPLET ${suffix}`, category: "misc", status: "pending", justified: false },
  });
  await request.post("http://127.0.0.1:3001/api/transactions", {
    data: { ...base, id: readyId, label: `RAPPROCHEMENT PRET ${suffix}`, category: "restaurant", status: "validated", justified: true },
  });

  const rejected = await request.patch(`http://127.0.0.1:3001/api/reconcile/${blockedId}`, { data: { reconciled: true } });
  expect(rejected.status()).toBe(409);

  await page.goto("/");
  await page.getByRole("button", { name: /Rapprochement$/i }).click();

  const blockedRow = page.getByRole("row").filter({ hasText: `RAPPROCHEMENT INCOMPLET ${suffix}` });
  await expect(blockedRow).toContainText("Valider la transaction");
  await expect(blockedRow).toContainText("Choisir une catégorie");
  await expect(blockedRow).toContainText("Ajouter ou valider un justificatif");
  await expect(blockedRow.getByRole("button")).toBeDisabled();

  const readyRow = page.getByRole("row").filter({ hasText: `RAPPROCHEMENT PRET ${suffix}` });
  await expect(readyRow).toContainText("Prête à rapprocher");
  await readyRow.getByTitle("Marquer comme rapprochée").click();
  await expect(readyRow).toContainText("Rapprochée");
});
