import { test, expect } from "@playwright/test";
import type { HouseholdState } from "../frontend/src/types/household";

test("two partners import, allocate, transfer, attach receipts and resolve concurrent edits",async({page,browser},testInfo)=>{
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto("/");
  await page.getByPlaceholder("Votre nom complet").fill("Alice");
  await page.getByPlaceholder("ex: admin").fill("alice");
  await page.getByPlaceholder("Mot de passe sécurisé").fill("test-password-123");
  await page.getByPlaceholder("Répéter le mot de passe").fill("test-password-123");
  await page.getByRole("button",{name:"Créer le compte et commencer"}).click();
  await page.getByRole("button",{name:"+ Nouveau foyer",exact:true}).click();
  await page.getByLabel("Deuxième personne").fill("Bob");
  await page.getByRole("button",{name:"Créer le foyer",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Votre argent, une vue commune"})).toBeVisible();
  const workspace=new URL(page.url()).searchParams.get("workspace")!;
  const endpoint="/api/workspaces/"+workspace+"/household";
  let state:HouseholdState=await (await page.request.get(endpoint)).json();
  expect(state.accounts).toHaveLength(6);
  const privateWorkspace=await(await page.request.post("/api/workspaces",{data:{name:"Private business",kind:"business"}})).json();
  const invitation=await (await page.request.post("/api/auth/invite",{data:{role:"admin",workspaceId:workspace}})).json();
  const second=await browser.newContext({baseURL:"http://localhost:5174"});
  const accepted=await second.request.post("/api/auth/invite/"+invitation.token+"/accept",{data:{username:"bob",displayName:"Bob",password:"test-password-123"}});
  expect(accepted.status()).toBe(201);
  expect((await second.request.get("/api/workspaces/"+privateWorkspace.id+"/transactions")).status()).toBe(403);
  const bob=await second.newPage();await bob.goto("/?workspace="+workspace);
  await expect(bob.getByRole("heading",{name:"Votre argent, une vue commune"})).toBeVisible();
  const date=new Date().toISOString().slice(0,10);
  await page.getByRole("button",{name:"Importer",exact:true}).click();
  await page.getByLabel("Relevé bancaire").setInputFiles({name:"bank.csv",mimeType:"text/csv",buffer:Buffer.from("Date;Libellé;Montant\n"+date+";Internet partagé;-100\n")});
  await page.getByRole("button",{name:"Prévisualiser",exact:true}).click();
  await expect(page.getByText("Internet partagé",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Importer la sélection",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("1 mouvements importés");
  await page.getByRole("button",{name:"Mouvements",exact:true}).click();
  await page.getByRole("button",{name:"Modifier",exact:true}).click();
  await page.getByRole("button",{name:"+ Affectation",exact:true}).click();
  await page.getByRole("button",{name:"+ Affectation",exact:true}).click();
  const contexts=[state.contexts[0],...state.contexts.filter(c=>c.kind==="activity")];
  for(let i=0;i<3;i++){
    await page.getByLabel("Contexte "+(i+1),{exact:true}).selectOption(contexts[i].id);
    await page.getByLabel("Catégorie "+(i+1),{exact:true}).fill("Internet");
    await page.getByLabel("Montant affecté "+(i+1),{exact:true}).fill(String([-60,-25,-15][i]));
  }
  await page.getByLabel("Affectations vérifiées").check();
  await page.getByRole("button",{name:"Enregistrer",exact:true}).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const proSummary=await (await page.request.get(endpoint+"/summary?contextId="+contexts[1].id)).json();
  expect(proSummary.expenses).toBe(2500);
  // Each browser keeps its own filters.
  await page.getByLabel("Vue",{exact:true}).selectOption(contexts[1].id);
  await expect(bob.getByLabel("Vue",{exact:true})).toHaveValue("all");
  await page.getByLabel("Vue",{exact:true}).selectOption("all");
  await bob.reload();
  await bob.getByRole("button",{name:"Modifier",exact:true}).click();
  await page.getByRole("button",{name:"Modifier",exact:true}).click();
  await page.getByLabel("Notes",{exact:true}).fill("Modification Alice");
  await page.getByRole("button",{name:"Enregistrer",exact:true}).click();
  await bob.getByLabel("Notes",{exact:true}).fill("Modification Bob");
  await bob.getByRole("button",{name:"Enregistrer",exact:true}).click();
  await expect(bob.getByRole("alert")).toContainText("modifié");
  await bob.getByRole("button",{name:"Recharger et revoir le mouvement"}).click();
  // Receipt upload is revision checked and visible to the second user.
  await page.getByRole("button",{name:"Modifier",exact:true}).click();
  await page.getByLabel("Ajouter un justificatif").setInputFiles({name:"internet.pdf",mimeType:"application/pdf",buffer:Buffer.from("%PDF-1.4\n% test receipt\n")});
  await expect(page.getByRole("link",{name:"internet.pdf"})).toBeVisible();
  await page.getByRole("button",{name:"Annuler",exact:true}).click();
  state=await(await page.request.get(endpoint)).json();
  expect((await second.request.get(endpoint+"/receipts/"+state.transactions[0].attachments[0].id)).status()).toBe(200);
  // Two movements become a single internal transfer and one contribution.
  for(const [accountId,cents]of [[state.accounts[0].id,-80000],[state.accounts[4].id,80000]] as const){
    const response=await page.request.post(endpoint+"/commands",{data:{revision:state.revision,action:"transaction",transaction:{accountId,date,label:"Virement foyer",cents}}});
    expect(response.status()).toBe(200);state=await response.json();
  }
  const pair=state.transactions.slice(-2);
  const matched=await page.request.post(endpoint+"/commands",{data:{revision:state.revision,action:"transfer",fromId:pair[0].id,toId:pair[1].id}});
  expect(matched.status()).toBe(200);
  const summary=await(await page.request.get(endpoint+"/summary")).json();
  expect(summary.expenses).toBe(10000);expect(summary.income).toBe(0);expect(summary.contributions[0].net).toBe(80000);
  expect((await page.request.get("/api/workspaces/"+workspace+"/accounting/fec")).status()).toBe(403);
  const csv=await(await page.request.get(endpoint+"/export?mode=allocations&contextId="+contexts[1].id)).text();
  expect(csv).toContain('"-25.00"');
  await page.reload();
  await expect(page.getByRole("heading",{name:"Votre argent, une vue commune"})).toBeVisible();
  await expect(page.getByRole("heading",{name:"Comptes et contributions"})).toBeAttached();
  await page.screenshot({path:testInfo.outputPath("household-desktop.png"),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:testInfo.outputPath("household-mobile.png"),fullPage:true});
  expect(errors).toEqual([]);
  await second.close();
});
