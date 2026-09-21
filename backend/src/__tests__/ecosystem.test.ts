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

});
