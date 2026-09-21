import { test, expect } from "@playwright/test";

test("edit the structure and retain one joint account with multiple holders",async({page},testInfo)=>{
  const apiRequests:string[]=[];const errors:string[]=[];
  page.on("request",r=>{if(new URL(r.url()).pathname.startsWith("/api/"))apiRequests.push(r.url());});
  page.on("pageerror",e=>errors.push(e.message));
  await page.goto("/?prototype=ecosystem");
  await expect(page.getByRole("heading",{name:"Structure financière"})).toBeVisible();
  await page.getByRole("button",{name:"Inspecter Commun · Charges",exact:true}).click();
  const inspector=page.getByRole("complementary",{name:"Propriétés de l’élément"});
  await expect(inspector.getByRole("button",{name:"Augustin",exact:true})).toBeVisible();
  await expect(inspector.getByRole("button",{name:"Partenaire",exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Inspecter Commun · Charges",exact:true})).toHaveCount(1);
  await page.screenshot({path:testInfo.outputPath("structure-desktop.png"),fullPage:true});
  await page.getByRole("button",{name:"+ Ajouter",exact:true}).click();
  await page.getByRole("button",{name:"Compte bancaire",exact:false}).click();
  const dialog=page.getByRole("dialog");
  await dialog.getByLabel("Nom",{exact:true}).fill("Épargne commune");
  await dialog.getByLabel("Usage").selectOption("Épargne");
  await dialog.getByRole("button",{name:"Ajouter",exact:true}).click();
  await expect(inspector.getByRole("heading",{name:"Épargne commune"})).toBeVisible();
  for(const owner of ["Augustin","Partenaire"]){
    await inspector.getByRole("button",{name:"+ Relation",exact:true}).click();
    await dialog.getByRole("combobox",{name:"De",exact:true}).selectOption({label:owner});
    await dialog.getByRole("combobox",{name:"Vers",exact:true}).selectOption({label:"Épargne commune"});
    await dialog.getByRole("button",{name:"Créer la relation",exact:true}).click();
  }
  await expect(page.getByRole("button",{name:"Inspecter Épargne commune"})).toContainText("Joint · 2 titulaires");
  await page.reload();
  await page.getByRole("button",{name:"Inspecter Épargne commune"}).click();
  await expect(inspector.getByRole("button",{name:"Partenaire",exact:true})).toBeVisible();
  await inspector.getByLabel("Nom de l’élément").fill("Épargne du foyer");
  await inspector.getByRole("button",{name:"Enregistrer les propriétés"}).click();
  await expect(page.getByRole("button",{name:"Inspecter Épargne du foyer"})).toBeVisible();
  await inspector.getByRole("button",{name:"Retirer la relation avec Partenaire"}).click();
  await expect(inspector.getByRole("button",{name:"Partenaire",exact:true})).toHaveCount(0);
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:testInfo.outputPath("structure-mobile.png"),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
  expect(apiRequests).toEqual([]);expect(errors).toEqual([]);
});

test("follow a mixed movement into its enterprise and preserve scoped tabs and filters",async({page},testInfo)=>{
  const requests:string[]=[];page.on("request",r=>{if(new URL(r.url()).pathname.startsWith("/api/"))requests.push(r.url());});
  await page.goto("/?prototype=ecosystem");
  await page.getByRole("button",{name:"Inspecter Personnel · Augustin",exact:true}).click();
  await page.getByRole("button",{name:"Ouvrir les mouvements ↗",exact:true}).click();
  await page.getByLabel("Rechercher",{exact:true}).fill("mixte");
  await page.getByRole("button",{name:"Achat mixte · matériel ↗",exact:true}).click();
  await page.getByRole("button",{name:"Ouvrir le traitement · Studio Augustin ↗"}).click();
  await expect(page.getByRole("heading",{name:"Traitement professionnel"})).toBeVisible();
  await expect(page.getByLabel("Périmètre actif")).toHaveValue("studio");
  await page.getByRole("button",{name:"Simuler la validation"}).click();
  await expect(page.getByRole("status")).toHaveText("Validation simulée dans cet onglet.");
  await page.screenshot({path:testInfo.outputPath("company-treatment.png"),fullPage:true});
  await page.getByRole("tab",{name:"Mouvements · Personnel · Augustin",exact:false}).click();
  await expect(page.getByLabel("Rechercher",{exact:true})).toHaveValue("mixte");
  await page.getByLabel("Période",{exact:true}).selectOption("2026-08");
  await page.getByRole("tab",{name:"Structure · Notre foyer",exact:false}).click();
  await expect(page.getByRole("button",{name:"Inspecter Personnel · Augustin",exact:true})).toHaveAttribute("aria-pressed","true");
  await page.getByRole("tab",{name:"Mouvements · Personnel · Augustin",exact:false}).click();
  await expect(page.getByLabel("Période",{exact:true})).toHaveValue("2026-08");
  await expect(page.getByRole("button",{name:"Achat mixte · abonnement ↗"})).toBeVisible();
  await page.getByLabel("Périmètre actif").selectOption("atelier");
  await page.getByRole("button",{name:/TVA$/}).click();
  await expect(page.getByRole("heading",{name:"TVA",exact:true})).toHaveCount(2);
  await expect(page.getByLabel("Périmètre actif")).toHaveValue("atelier");
  await page.getByRole("tab",{name:"Traitement · Studio Augustin",exact:false}).click();
  await expect(page.getByLabel("Périmètre actif")).toHaveValue("studio");
  await expect(page.getByRole("status")).toHaveText("Validation simulée dans cet onglet.");
  expect(requests).toEqual([]);
});

test("inspect flows and open the source movement without losing the selected period",async({page},testInfo)=>{
  await page.goto("/?prototype=ecosystem");
  await page.getByRole("button",{name:"Voir les flux ↗",exact:true}).click();
  await page.getByRole("complementary",{name:"Détail du flux"}).getByRole("button",{name:/Achat mixte · matériel/}).click();
  await expect(page.getByRole("complementary",{name:"Détail du flux"})).toContainText("100,00");
  await page.screenshot({path:testInfo.outputPath("flows-desktop.png"),fullPage:true});
  await page.getByRole("button",{name:"Ouvrir le mouvement ↗",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Détail du mouvement",exact:true})).toBeVisible();
  await page.getByRole("tab",{name:"Flux · Notre foyer",exact:false}).click();
  await expect(page.getByRole("heading",{name:"Achat mixte · matériel",exact:true})).toBeVisible();
  await page.getByLabel("Période",{exact:true}).selectOption("2026-08");
  await page.getByRole("button",{name:"Liste des flux",exact:true}).click();
  await expect(page.getByRole("button",{name:/Achat mixte · abonnement/})).toHaveCount(2);
});


test("arrange floating nodes and model a holding with company participations",async({page},testInfo)=>{
  await page.addInitScript(()=>{Object.defineProperty(crypto,"randomUUID",{value:undefined,configurable:true});});
  await page.goto("/?prototype=ecosystem");
  const inspector=page.getByRole("complementary",{name:"Propriétés de l’élément"});
  const dialog=page.getByRole("dialog");
  for(const [name,kind] of [["Holding familiale","Holding"],["SCI du foyer","SCI"]]){
    await page.getByRole("button",{name:"+ Ajouter",exact:true}).click();
    await page.getByRole("button",{name:"◇ Entreprise",exact:true}).click();
    await dialog.getByLabel("Nom",{exact:true}).fill(name);
    await dialog.getByRole("combobox",{name:"Type d’entreprise"}).selectOption(kind);
    await dialog.getByRole("button",{name:"Ajouter",exact:true}).click();
  }
  for(const child of ["Studio Augustin","SCI du foyer"]){
    await inspector.getByRole("button",{name:"+ Relation",exact:true}).click();
    await dialog.getByRole("combobox",{name:"Relation",exact:true}).selectOption("subsidiary");
    await dialog.getByRole("combobox",{name:"De",exact:true}).selectOption({label:"Holding familiale"});
    await dialog.getByRole("combobox",{name:"Vers",exact:true}).selectOption({label:child});
    await dialog.getByRole("button",{name:"Créer la relation",exact:true}).click();
  }
  await page.getByLabel("Disposition de la carte").selectOption("hierarchy");
  const holding=page.getByRole("button",{name:"Inspecter Holding familiale",exact:true});
  const sci=page.getByRole("button",{name:"Inspecter SCI du foyer",exact:true});
  const holdingY=await holding.evaluate(e=>parseFloat((e as HTMLElement).style.top));
  expect(await sci.evaluate(e=>parseFloat((e as HTMLElement).style.top))).toBeGreaterThan(holdingY);
  await sci.click();
  await expect(inspector).toContainText("Entreprise mère");
  await expect(inspector.getByRole("button",{name:"Holding familiale",exact:true})).toBeVisible();
  await page.screenshot({path:testInfo.outputPath("hierarchy-desktop.png"),fullPage:true});
  await inspector.getByRole("button",{name:"+ Relation",exact:true}).click();
  await dialog.getByRole("combobox",{name:"Relation",exact:true}).selectOption("subsidiary");
  await dialog.getByRole("combobox",{name:"De",exact:true}).selectOption({label:"SCI du foyer"});
  await dialog.getByRole("combobox",{name:"Vers",exact:true}).selectOption({label:"Holding familiale"});
  await expect(dialog.getByRole("alert")).toContainText("boucle");
  await expect(dialog.getByRole("button",{name:"Créer la relation",exact:true})).toBeDisabled();
  await dialog.getByRole("button",{name:"Annuler",exact:true}).click();

  await page.getByLabel("Disposition de la carte").selectOption("free");
  await page.getByLabel("Zoom de la carte").selectOption("0.75");
  await holding.scrollIntoViewIfNeeded();
  const initial=await holding.evaluate(e=>({x:parseFloat((e as HTMLElement).style.left),y:parseFloat((e as HTMLElement).style.top)}));
  const box=(await holding.boundingBox())!;
  await page.mouse.move(box.x+60,box.y+25);
  await page.mouse.down();
  await page.mouse.move(box.x+135,box.y+70,{steps:12});
  await page.mouse.up();
  const moved=await holding.evaluate(e=>({x:parseFloat((e as HTMLElement).style.left),y:parseFloat((e as HTMLElement).style.top)}));
  expect(moved.x-initial.x).toBeCloseTo(100,0);
  expect(moved.y-initial.y).toBeCloseTo(60,0);
  await holding.focus();
  await holding.press("ArrowRight");
  await expect(holding).toHaveCSS("left",(moved.x+10)+"px");
  await page.getByLabel("Disposition de la carte").selectOption("columns");
  await page.getByLabel("Disposition de la carte").selectOption("free");
  await expect(holding).toHaveCSS("left",(moved.x+10)+"px");
  await page.reload();
  await expect(page.getByLabel("Disposition de la carte")).toHaveValue("free");
  await expect(holding).toHaveCSS("left",(moved.x+10)+"px");
  await page.getByLabel("Zoom de la carte").selectOption("0.75");
  await holding.click();
  await page.screenshot({path:testInfo.outputPath("free-desktop.png"),fullPage:true});
  await page.getByLabel("Disposition de la carte").selectOption("hierarchy");
  await expect(holding).toContainText("Holding");
  await expect(sci).toContainText("SCI");
});

