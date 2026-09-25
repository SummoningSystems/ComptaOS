import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import Fastify from "fastify";
import jwt from "jsonwebtoken";
import {beforeAll,afterAll,describe,it,expect,vi} from "vitest";
import type {Ecosystem} from "../types/ecosystem.js";
describe("persisted financial ecosystem",()=>{
 let root:string,state:Ecosystem,owner:{id:string},partner:{id:string},outsider:{id:string},reader:{id:string};
 let auth:typeof import("../services/authService.js"),companies:typeof import("../services/companiesService.js");
 const app=Fastify();let endpoint:string;
 const cookie=(user=owner)=>({cookie:"comptaos_token="+jwt.sign({sub:user.id,role:"owner"},auth.getJwtSecret())});
 async function command(input:Record<string,unknown>){const response=await app.inject({method:"POST",url:endpoint+"/commands",headers:cookie(),payload:{revision:state.revision,...input}});expect(response.statusCode,response.body).toBe(200);state=response.json();return state;}
 beforeAll(async()=>{
  root=await fs.mkdtemp(path.join(os.tmpdir(),"comptaos-ecosystem-"));vi.stubEnv("WORKSPACE_PATH",root);vi.stubEnv("AUTH_ENABLED","true");vi.resetModules();
  auth=await import("../services/authService.js");companies=await import("../services/companiesService.js");
  owner=await auth.createOwner("alice","Alice","password-test-123");partner=await auth.createUser("bob","Bob","password-test-123","member",owner.id);reader=await auth.createUser("reader","Reader","password-test-123","readonly",owner.id);outsider=await auth.createUser("other","Other","password-test-123","member",owner.id);
  (await import("../services/workspaceAccess.js")).registerAccessControl(app);
  await app.register((await import("../routes/ecosystems.js")).ecosystemsRoutes,{prefix:"/api/ecosystems"});
  await app.register((await import("../routes/transactions.js")).transactionsRoutes,{prefix:"/api/workspaces/:workspaceId/transactions"});
  await app.register((await import("../routes/accounting.js")).accountingRoutes,{prefix:"/api/workspaces/:workspaceId/accounting"});
  await app.register((await import("../routes/recurring.js")).recurringRoutes,{prefix:"/api/workspaces/:workspaceId/recurring"});
  await app.register((await import("../routes/settings.js")).settingsRoutes,{prefix:"/api/workspaces/:workspaceId/settings"});
  const result=await app.inject({method:"POST",url:"/api/ecosystems",headers:cookie(),payload:{name:"Ensemble"}});expect(result.statusCode,result.body).toBe(201);state=result.json();endpoint="/api/ecosystems/"+state.id;
  for(const user of [partner,reader])expect((await app.inject({method:"POST",url:endpoint+"/members",headers:cookie(),payload:{userId:user.id}})).statusCode).toBe(200);
 });
 afterAll(async()=>{await app.close();vi.unstubAllGlobals();vi.unstubAllEnvs();await fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 it("starts empty and creates dynamic people, companies and accounts",async()=>{
  expect(state.entities).toHaveLength(0);
  for(const e of [{id:"alice",kind:"person",name:"Alice"},{id:"bob",kind:"person",name:"Bob"},{id:"studio",kind:"company",name:"Studio",accountingEnabled:true},{id:"holding",kind:"company",name:"Holding",companyType:"Holding"},{id:"sci",kind:"company",name:"SCI",companyType:"SCI"},...Array.from({length:7},(_,i)=>({id:"bank"+i,kind:"account",name:"Compte "+i}))])await command({action:"entity",entity:e});
  expect(state.entities.filter(e=>e.kind==="account")).toHaveLength(7);
  for(const from of ["alice","bob"])await command({action:"relation",relation:{from,to:"bank4",kind:"holder"}});
  expect(state.relations.filter(r=>r.to==="bank4")).toHaveLength(2);
  await command({action:"relation",relation:{from:"holding",to:"sci",kind:"subsidiary"}});
  const cycle=await app.inject({method:"POST",url:endpoint+"/commands",headers:cookie(),payload:{revision:state.revision,action:"relation",relation:{from:"sci",to:"holding",kind:"subsidiary"}}});expect(cycle.statusCode).toBe(400);
 });
 it("enforces membership and current roles in ecosystem and child company APIs",async()=>{
  expect((await app.inject({url:endpoint,headers:cookie(partner)})).statusCode).toBe(200);
  expect((await app.inject({url:endpoint,headers:cookie(outsider)})).statusCode).toBe(403);
  const child=state.entities.find(e=>e.id==="studio")!.workspaceId;
  expect((await app.inject({url:"/api/workspaces/"+child+"/transactions",headers:cookie(partner)})).statusCode).toBe(200);
  expect((await app.inject({url:"/api/workspaces/"+child+"/transactions",headers:cookie(outsider)})).statusCode).toBe(403);
  expect((await app.inject({method:"POST",url:endpoint+"/commands",headers:cookie(reader),payload:{revision:state.revision,action:"entity",entity:{id:"bad",kind:"person",name:"Bad"}}})).statusCode).toBe(403);
 });
 it("imports once per account and persists provenance",async()=>{
  const input={format:"csv",accountId:"bank0",content:"Date;Label;Amount\n2026-09-01;Mixed purchase;-100",mapping:{date:"Date",label:"Label",amount:"Amount"}};
  await command({action:"import",import:input});await command({action:"import",import:input});expect(state.movements).toHaveLength(1);expect(state.movements[0].source?.provider).toBe("file");
  await command({action:"import",import:{...input,accountId:"bank1"}});expect(state.movements).toHaveLength(2);
 });
 it("links a 70 euro treatment to a 100 euro bank movement without duplicating cash",async()=>{
  const m=state.movements[0];await command({action:"movement",id:m.id,expectedRevision:m.revision,movement:{allocations:[{id:"professional",target:"studio",category:"Matériel",cents:-7000},{id:"personal",target:"alice",category:"Matériel",cents:-3000}]}});
  expect(state.movements).toHaveLength(2);expect(state.treatments).toHaveLength(1);expect(state.treatments[0].transaction.amount_ttc).toBe(-70);
  const child=state.entities.find(e=>e.id==="studio")!.workspaceId;
  const t=state.treatments[0].transaction;
  const rejected=await app.inject({method:"PATCH",url:"/api/workspaces/"+child+"/transactions/"+t.id,headers:cookie(),payload:{amount_ttc:-100}});expect(rejected.statusCode).toBe(400);
  const accepted=await app.inject({method:"PATCH",url:"/api/workspaces/"+child+"/transactions/"+t.id,headers:cookie(),payload:{revision:t.revision,category:"equipment",invoiceRef:"INV-1",settlement:{accountNumber:"455100",label:"Avance Alice",journalCode:"OD",journalLabel:"Opérations diverses",payerId:"alice"},status:"validated",reconciled:true}});expect(accepted.statusCode,accepted.body).toBe(200);
  state=(await app.inject({url:endpoint,headers:cookie()})).json();expect(state.treatments[0].transaction.settlement?.accountNumber).toBe("455100");
  const blocked=await app.inject({method:"POST",url:endpoint+"/commands",headers:cookie(),payload:{revision:state.revision,action:"movement",id:m.id,expectedRevision:state.movements[0].revision,movement:{notes:"change"}}});expect(blocked.statusCode).toBe(409);
  await command({action:"reopen",id:t.id});
 });
 it("rejects stale writes without losing the successful edit",async()=>{
  const m=state.movements[0],revision=state.revision;
  const responses=await Promise.all([owner,partner].map((user,i)=>app.inject({method:"POST",url:endpoint+"/commands",headers:cookie(user),payload:{revision,action:"movement",id:m.id,expectedRevision:m.revision,movement:{notes:"Edit "+i}}})));
  expect(responses.map(r=>r.statusCode).sort()).toEqual([200,409]);state=(await app.inject({url:endpoint,headers:cookie()})).json();expect(state.movements[0].notes).toMatch(/^Edit/);
 });
 it("stores shared documents once and protects their download",async()=>{
  const boundary="test-boundary",file="%PDF-1.4\n%%EOF";const body=`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="receipt.pdf"\r\nContent-Type: application/pdf\r\n\r\n${file}\r\n--${boundary}--\r\n`;
  const uploaded=await app.inject({method:"POST",url:endpoint+"/documents?revision="+state.revision+"&scope=alice&movement="+state.movements[0].id,headers:{...cookie(),"content-type":"multipart/form-data; boundary="+boundary},payload:body});expect(uploaded.statusCode,uploaded.body).toBe(200);state=uploaded.json();expect(state.documents).toHaveLength(1);
  const url=endpoint+"/documents/"+state.documents[0].id+"/file";
  expect((await app.inject({url,headers:cookie(partner)})).body).toBe(file);expect((await app.inject({url,headers:cookie(outsider)})).statusCode).toBe(403);
 });
 it("preserves transfers and recurring forecasts separately from expenses",async()=>{
  for(const [accountId,cents]of [["bank0",-80000],["bank4",80000]] as const)await command({action:"movement",movement:{accountId,date:"2026-09-02",label:"Transfer",cents}});
  const [a,b]=state.movements.slice(-2);await command({action:"transfer",fromId:a.id,toId:b.id});expect(state.transfers).toHaveLength(1);
  const count=state.movements.length;await command({action:"budget",budget:{id:"",target:"root",category:"Courses",cents:50000}});
  await command({action:"recurring",recurring:{id:"",label:"Loyer",accountId:"bank4",cents:90000,allocations:[{id:"rent",target:"root",category:"Loyer",cents:-90000}],frequency:"monthly",nextDate:"2026-10-01",active:true}});expect(state.movements).toHaveLength(count);
  expect((await app.inject({url:endpoint,headers:cookie()})).json().recurring).toHaveLength(1);
 });
 it("fetches all bank pages, deduplicates repeats, and queues source corrections",async()=>{
  const secret={domain:"test",clientId:"client",clientSecret:"secret"};expect((await app.inject({method:"POST",url:endpoint+"/banking/config",headers:cookie(),payload:secret})).statusCode).toBe(200);
  const folder=companies.resolveCompanyPath(companies.loadCompanies().find(c=>c.id===state.id)!);
  await fs.writeFile(path.join(folder,".powens_profiles.json"),JSON.stringify({[owner.id]:{token:"fake-token",configKey:createHash("sha256").update(secret.domain+secret.clientId+secret.clientSecret).digest("hex")}}));
  let amount=-10;
  vi.stubGlobal("fetch",vi.fn(async(url:URL|string)=>{const u=String(url);return new Response(JSON.stringify(u.includes("/transactions")?{transactions:[{id:u.includes("page=2")?2:1,id_account:42,date:"2026-09-04",value:amount,wording:"Bank"}],_links:u.includes("page=2")?{}:{next:{href:"/2.0/users/me/accounts/42/transactions?limit=1000&page=2"}}}:{accounts:[{id:42,id_connection:7,name:"Bank",currency:{id:"EUR"},balance:200}]}),{status:200});}));
  const mapped=await app.inject({method:"POST",url:endpoint+"/banking/map",headers:cookie(),payload:{revision:state.revision,providerAccountId:42,accountId:"bank6"}});expect(mapped.statusCode,mapped.body).toBe(200);state=mapped.json();
  const url=endpoint+"/banking/feeds/"+state.feeds[0].id+"/sync";
  for(let i=0;i<2;i++){const synced=await app.inject({method:"POST",url,headers:cookie()});expect(synced.statusCode,synced.body).toBe(200);state=synced.json();}
  expect(state.movements.filter(m=>m.source?.provider==="powens")).toHaveLength(2);
  amount=-12;state=(await app.inject({method:"POST",url,headers:cookie()})).json();const m=state.movements.find(m=>m.source?.provider==="powens")!;expect(m.cents).toBe(-1000);expect(m.sourceChange?.cents).toBe(-1200);
 });
 it("keeps personal payments out of company cash and exports their explicit counterpart",async()=>{
  const {workspaceContext,actorContext}=await import("../services/workspaceContext.js");
  const company=companies.loadCompanies().find(c=>c.id===state.entities.find(e=>e.id==="studio")!.workspaceId)!;
  await actorContext.run({id:owner.id,role:"owner"},()=>workspaceContext.run({id:company.id,root:companies.resolveCompanyPath(company),kind:"business",actor:owner.id,role:"owner"},async()=>{
    const data=await(await import("../services/dashboardService.js")).computeDashboard("2026");
    expect(data.cash_unknown).toBe(true);expect(data.transaction_flow).toBe(0);expect(data.forecast).toEqual([]);
    const transactions=await(await import("../services/transactionService.js")).loadAllTransactions();
    const t={...transactions[0],status:"validated" as const,reconciled:true};
    const config=(await import("../services/settingsService.js")).loadAccountingConfig();
    const preview=(await import("../services/accountingExportService.js")).buildAccountingPreview([t],config,"2026");
    expect(preview.balanced).toBe(true);expect(preview.lines.some(l=>l.accountNumber==="455100"&&l.credit===70)).toBe(true);
    expect(preview.lines.some(l=>l.accountNumber==="512000")).toBe(false);
  }));
 });
 it("creates a neutral transfer treatment and prevents validated relationship changes",async()=>{
  await command({action:"relation",relation:{from:"studio",to:"bank0",kind:"holder"}});
  const transfer=state.transfers[0],t=state.treatments.find(t=>t.transferId===transfer.id)!;
  expect(t.transaction.category).toBe("internal_transfer");expect(t.transaction.amount_ttc).toBe(-800);
  const company=state.entities.find(e=>e.id==="studio")!;
  const response=await app.inject({method:"PATCH",url:"/api/workspaces/"+company.workspaceId+"/transactions/"+t.transaction.id,headers:cookie(),payload:{revision:t.transaction.revision,status:"validated",reconciled:true,settlement:{accountNumber:"512000",label:"Banque",journalCode:"BQ",journalLabel:"Banque",transferAccount:{number:"455100",label:"Avance"}}}});
  expect(response.statusCode,response.body).toBe(200);state=(await app.inject({url:endpoint,headers:cookie()})).json();
  const relation=state.relations.find(r=>r.from==="studio"&&r.to==="bank0")!;
  expect((await app.inject({method:"POST",url:endpoint+"/commands",headers:cookie(),payload:{revision:state.revision,action:"disconnect",id:relation.id}})).statusCode).toBe(409);
 });
 it("applies a bulk classification atomically and rejects a stale selection",async()=>{
  const m=state.movements.find(m=>m.accountId==="bank1")!;
  await command({action:"bulk-movement",items:[{id:m.id,revision:m.revision}],target:"bob",category:"Personnel",reviewed:true});
  const after=state.movements.find(x=>x.id===m.id)!;expect(after.allocations[0].target).toBe("bob");
  const stale=await app.inject({method:"POST",url:endpoint+"/commands",headers:cookie(),payload:{revision:state.revision,action:"bulk-movement",items:[{id:m.id,revision:m.revision}],target:"root",category:"Wrong"}});expect(stale.statusCode).toBe(409);
  expect((await app.inject({url:endpoint,headers:cookie()})).json().movements.find((x:{id:string})=>x.id===m.id).allocations[0].target).toBe("bob");
 });
 it("exports shared evidence in the company package and protects validated links",async()=>{
  const t=state.treatments.find(t=>!t.transferId)!,company=companies.loadCompanies().find(c=>c.id===state.entities.find(e=>e.id==="studio")!.workspaceId)!;
  const response=await app.inject({method:"PATCH",url:"/api/workspaces/"+company.id+"/transactions/"+t.transaction.id,headers:cookie(),payload:{revision:t.transaction.revision,status:"validated",reconciled:true}});expect(response.statusCode,response.body).toBe(200);
  const {workspaceContext}=await import("../services/workspaceContext.js");
  await workspaceContext.run({id:company.id,root:companies.resolveCompanyPath(company),kind:"business",actor:owner.id,role:"owner"},async()=>{const settings=await import("../services/settingsService.js");settings.saveCompanyProfile({...settings.loadCompanyProfile(),siren:"123456789"});});
  const archive=await app.inject({url:"/api/workspaces/"+company.id+"/accounting/package?year=2026",headers:cookie()});expect(archive.statusCode,archive.body.slice(0,200)).toBe(200);expect(archive.rawPayload.includes(Buffer.from("justificatifs/"+state.documents[0].id))).toBe(true);
  state=(await app.inject({url:endpoint,headers:cookie()})).json();const doc=state.documents[0];
  expect((await app.inject({method:"POST",url:endpoint+"/commands",headers:cookie(),payload:{revision:state.revision,action:"document",id:doc.id,document:{...doc,movementIds:[]}}})).statusCode).toBe(409);
 });
 it("recovers an interrupted durable commit before serving the next read",async()=>{
  const folder=companies.resolveCompanyPath(companies.loadCompanies().find(c=>c.id===state.id)!);
  const pending={...state,revision:state.revision+1,name:"Recovered ecosystem"};
  await fs.writeFile(path.join(folder,"ecosystem.pending.json"),JSON.stringify(pending));
  const recovered=await app.inject({url:endpoint,headers:cookie()});expect(recovered.statusCode,recovered.body).toBe(200);state=recovered.json();expect(state.name).toBe(pending.name);
  expect(JSON.parse(await fs.readFile(path.join(folder,"ecosystem.json"),"utf8")).revision).toBe(pending.revision);
  await expect(fs.stat(path.join(folder,"ecosystem.pending.json"))).rejects.toMatchObject({code:"ENOENT"});
 });

 it("persists shared spreadsheets separately for each scope and enforces membership",async()=>{
  const base=endpoint+"/tableaux/root";
  const created=await app.inject({method:"POST",url:base,headers:cookie(),payload:{name:"Budget commun"}});expect(created.statusCode,created.body).toBe(201);const doc=created.json();doc.sheets[0].cells={A1:{value:"=SUM(1,2)"}};
  expect((await app.inject({method:"PUT",url:base+"/"+doc.id,headers:cookie(),payload:doc})).statusCode).toBe(200);
  expect((await app.inject({url:base+"/"+doc.id,headers:cookie(partner)})).json().sheets[0].cells.A1.value).toBe("=SUM(1,2)");
  expect((await app.inject({url:endpoint+"/tableaux/alice",headers:cookie()})).json()).toEqual([]);
  expect((await app.inject({url:base,headers:cookie(outsider)})).statusCode).toBe(403);
  expect((await app.inject({method:"PUT",url:base+"/"+doc.id,headers:cookie(reader),payload:doc})).statusCode).toBe(403);
  expect((await app.inject({url:base+"/variables",headers:cookie()})).json()).toMatchObject({affectations_depenses_total:220,affectations_revenus_total:0});
 });

 it("stores dated dedicated cash and rejects overlapping assignments atomically",async()=>{
  const account=state.entities.find(e=>e.id==="bank0")!;
  await command({action:"entity",entity:{...account,treasuryAssignments:[{companyId:"studio",from:"2026-01-01",to:"2026-12-31"}]}});
  const response=await app.inject({method:"POST",url:endpoint+"/commands",headers:cookie(),payload:{revision:state.revision,action:"entity",entity:{...state.entities.find(e=>e.id==="bank0"),treasuryAssignments:[{companyId:"studio",from:"2026-01-01"},{companyId:"holding",from:"2026-09-01"}]}}});expect(response.statusCode).toBe(400);
  expect((await app.inject({url:endpoint,headers:cookie()})).json().revision).toBe(state.revision);
 });
 it("shares named variables with spreadsheets and retains IDs after renaming",async()=>{
  await command({action:"variable",variable:{id:"expense_alice",name:"Personnel",scope:"alice",metric:"expenses",period:"2026-09"}});
  const variables=(await app.inject({url:endpoint+"/variables",headers:cookie()})).json();expect(variables[0].value).toBe(30);
  const values=(await app.inject({url:endpoint+"/tableaux/root/variables",headers:cookie()})).json();expect(values.v_expense_alice).toBe(30);
  await command({action:"variable",variable:{...state.variables![0],name:"Personnel renommé"}});
  expect((await app.inject({url:endpoint+"/tableaux/root/variables",headers:cookie()})).json().v_expense_alice).toBe(30);
 });
 it("migrates v1 once with a byte-preserving backup and a review report",async()=>{
  const created=await app.inject({method:"POST",url:"/api/ecosystems",headers:cookie(),payload:{name:"Migration"}});const old=created.json() as Ecosystem;
  old.schemaVersion=1;old.entities=[{id:"cash",kind:"account",name:"Compte",defaultTarget:"root"}];old.movements=[{id:"migrate",accountId:"cash",date:"2026-09-01",label:"À classer",cents:-100,currency:"EUR",allocations:[{id:"allocation-kept",target:"root",category:"À classer",cents:-100}],revision:1,reviewed:false,nature:"expense",notes:""}];
  const folder=companies.resolveCompanyPath(companies.loadCompanies().find(c=>c.id===old.id)!);const raw=JSON.stringify(old);await fs.writeFile(path.join(folder,"ecosystem.json"),raw);
  const migrated=(await app.inject({url:"/api/ecosystems/"+old.id,headers:cookie()})).json();expect(migrated.schemaVersion).toBe(2);expect(migrated.movements[0].allocations[0]).toMatchObject({id:"allocation-kept",target:"unassigned"});expect(migrated.migration.review).toContain("movement:migrate");expect(await fs.readFile(path.join(folder,"ecosystem.v1.backup.json"),"utf8")).toBe(raw);
  expect((await app.inject({url:"/api/ecosystems/"+old.id,headers:cookie()})).json().revision).toBe(migrated.revision);
 });

 it("migrates legacy planning without double writes and rejects stale saves",async()=>{
  const company=companies.loadCompanies().find(c=>c.id===state.entities.find(e=>e.id==="studio")!.workspaceId)!;
  const file=path.join(companies.resolveCompanyPath(company),"settings","manual_recurring.json");const legacy=[{id:"legacy-rent",label:"Bureau",category:"rent",amount:200,frequency:"mensuel",nextPayment:"2026-10-01",active:true,decision:"reduce",simulatedAmount:150}];
  await fs.writeFile(file,JSON.stringify(legacy));const url="/api/workspaces/"+company.id+"/recurring/manual";
  const loaded=await app.inject({url,headers:cookie()});expect(loaded.statusCode,loaded.body).toBe(200);expect(loaded.json().find((r:{id:string})=>r.id==="legacy-rent").simulatedAmount).toBe(150);
  state=(await app.inject({url:endpoint,headers:cookie()})).json();expect(state.recurring.find(r=>r.id==="legacy-rent")?.accountId).toBe("");expect(state.planningMigrated).toContain("recurring:studio");
  const revision=state.revision;const saved=await app.inject({method:"PUT",url,headers:{...cookie(),"x-ecosystem-revision":String(revision)},payload:legacy.map(r=>({...r,amount:250}))});expect(saved.statusCode,saved.body).toBe(200);
  expect(JSON.parse(await fs.readFile(file,"utf8"))[0].amount).toBe(200);
  expect((await app.inject({method:"PUT",url,headers:{...cookie(),"x-ecosystem-revision":String(revision)},payload:legacy})).statusCode).toBe(409);
  state=(await app.inject({url:endpoint,headers:cookie()})).json();expect(state.recurring.find(r=>r.id==="legacy-rent")?.cents).toBe(25000);
 });
 it("applies accounting bulk changes atomically when one item is locked",async()=>{
  const company=state.entities.find(e=>e.id==="studio")!,url="/api/workspaces/"+company.workspaceId+"/transactions";
  const manual={id:"bulk-draft",date:"2026-10-01",label:"Draft",amount_ttc:-10,amount_ht:-10,vat:0,vat_rate:0,currency:"EUR",category:"misc",account:"",status:"pending"};
  expect((await app.inject({method:"POST",url,headers:cookie(),payload:manual})).statusCode).toBe(201);
  state=(await app.inject({url:endpoint,headers:cookie()})).json();const locked=state.treatments.find(t=>t.transaction.status==="validated")!;
  const result=await app.inject({method:"POST",url:url+"/smart-categorize/apply",headers:cookie(),payload:{changes:[{id:manual.id,category:"rent"},{id:locked.transaction.id,category:"rent"}]}});expect(result.statusCode).toBe(409);
  const after=(await app.inject({url,headers:cookie()})).json();expect(after.find((t:{id:string})=>t.id===manual.id).category).toBe("misc");
 });

 it("isolates free files by scope and excludes managed files from editing and search",async()=>{
  const base=endpoint+"/filespaces/alice/files";
  expect((await app.inject({method:"PUT",url:base+"/content",headers:cookie(),payload:{path:"note.md",content:"budget-personnel"}})).statusCode).toBe(200);
  expect((await app.inject({url:base+"/content?path=note.md",headers:cookie(partner)})).json().content).toBe("budget-personnel");
  expect((await app.inject({method:"PUT",url:base+"/content",headers:cookie(reader),payload:{path:"note.md",content:"bad"}})).statusCode).toBe(403);
  expect((await app.inject({method:"PUT",url:base+"/content",headers:cookie(),payload:{path:"transactions/fake.yaml",content:"bad"}})).statusCode).toBe(403);
  expect((await app.inject({method:"PUT",url:base+"/content",headers:cookie(),payload:{path:"notes/../transactions/fake.yaml",content:"bad"}})).statusCode).toBe(403);
  const results=(await app.inject({url:endpoint+"/search-files?q=budget-personnel",headers:cookie()})).json();expect(results).toEqual(expect.arrayContaining([expect.objectContaining({scope:"alice",path:"note.md"})]));
  expect((await app.inject({url:endpoint+"/search-files?q=fake-token",headers:cookie()})).json()).toEqual([]);
 });
 it("rejects stale spreadsheet writes without losing the successful version",async()=>{
  const base=endpoint+"/tableaux/alice";const created=(await app.inject({method:"POST",url:base,headers:cookie(),payload:{name:"Concurrent"}})).json();
  const one=await app.inject({method:"PUT",url:base+"/"+created.id,headers:cookie(),payload:{...created,name:"First"}});expect(one.statusCode,one.body).toBe(200);
  expect((await app.inject({method:"PUT",url:base+"/"+created.id,headers:cookie(partner),payload:{...created,name:"Stale"}})).statusCode).toBe(409);
  expect((await app.inject({url:base+"/"+created.id,headers:cookie()})).json().name).toBe("First");
 });

 it("returns structured local OCR without creating or validating financial records",async()=>{
  vi.stubEnv("OCR_LOCAL_URL","http://localhost:9999");
  vi.stubGlobal("fetch",vi.fn(async(url:string)=>{expect(String(url)).toBe("http://localhost:9999/ocr");return new Response(JSON.stringify({text:"BISTRO DU TEST\nFACTURE N-42\n04/08/2026\nTVA 10 % 16,18 1,62\nTVA 20 % 7,50 1,50\nTOTAL HT 23,68\nTOTAL TTC 26,80"}),{status:200});}));
  const before=(await app.inject({url:endpoint,headers:cookie()})).json();const response=await app.inject({method:"POST",url:endpoint+"/documents/"+before.documents[0].id+"/analyze",headers:cookie()});expect(response.statusCode,response.body).toBe(200);expect(response.json().proposal.vatSplits).toHaveLength(2);expect(response.json().proposal.amountTtc).toBe(26.8);
  const after=(await app.inject({url:endpoint,headers:cookie()})).json();expect(after.revision).toBe(before.revision);expect(after.movements).toEqual(before.movements);expect(after.treatments).toEqual(before.treatments);
 });

});
