import { expect, test } from "@playwright/test";

test.describe.serial("Structure patrimoniale et juridique", () => {
  test("complète une SCI et documente son associé", async ({ page }) => {
    test.setTimeout(60_000);
    const suffix = Date.now().toString().slice(-6);
    const structureName = `SCI Recette ${suffix}`;
    const personName = `Associé Recette ${suffix}`;

    await page.goto("/");
    await page.getByRole("button", { name: "Structure", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Structure financière" })).toBeVisible();

    const createStructure = page.getByRole("heading", { name: "Créer une structure comptable" }).locator("..");
    await createStructure.getByPlaceholder("Nom de la société ou structure").fill(structureName);
    await createStructure.locator("select").selectOption("sci");
    await createStructure.getByRole("button", { name: /créer le dossier comptable/i }).click();
    await expect(page.getByText(structureName, { exact: true }).first()).toBeVisible();

    const profile = page.getByRole("heading", { name: "Fiche complète de la structure" }).locator("xpath=ancestor::section[1]");
    await expect(profile).toBeVisible();
    await profile.getByLabel("Capital").fill("10000");
    await profile.getByLabel("Régime fiscal").selectOption("ir");
    await profile.getByLabel("Régime de TVA").selectOption("simplified_ca12");
    await profile.getByLabel("Début d’activité").fill("2026-01-01");
    await profile.getByLabel("Début exercice (MM-JJ)").fill("01-01");
    await profile.getByLabel("Fin exercice (MM-JJ)").fill("12-31");
    await profile.getByRole("button", { name: "Enregistrer la fiche" }).click();

    const createPerson = page.getByRole("heading", { name: "Ajouter une personne" }).locator("..");
    await createPerson.getByPlaceholder("Nom ou libellé").fill(personName);
    await createPerson.getByRole("button", { name: /ajouter$/i }).click();

    const relation = page.getByRole("heading", { name: "Créer un lien enrichi" }).locator("..");
    const selects = relation.locator("select");
    await selects.nth(0).selectOption({ label: personName });
    await selects.nth(1).selectOption("owner");
    await selects.nth(2).selectOption({ label: structureName });
    await relation.getByPlaceholder("Détention %").fill("100");
    await relation.getByPlaceholder("Nombre de parts").fill("1000");
    await selects.nth(3).selectOption({ label: personName });
    await relation.getByRole("button", { name: "Relier", exact: true }).click();
    await expect(page.getByText("Lien créé et affiché ci-dessous.")).toBeVisible();
    await expect(page.getByText("Détention 100 %")).toBeVisible();
  });

  test("reste utilisable sur un écran de téléphone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByRole("button", { name: "Interface complète" }).click();
    await page.getByRole("button", { name: "Structure", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Structure financière" })).toBeVisible();
    await expect(page.getByRole("button", { name: /réorganiser automatiquement/i })).toBeVisible();
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      offenders: [...document.querySelectorAll<HTMLElement>("body *")].filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1).slice(0, 5).map((element) => ({ tag: element.tagName, className: element.className, right: Math.round(element.getBoundingClientRect().right) })),
    }));
    expect(layout.overflow, JSON.stringify(layout.offenders)).toBeLessThanOrEqual(1);
  });
});
