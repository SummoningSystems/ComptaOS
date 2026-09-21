import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { HouseholdState, HouseholdImport } from "../types/household.js";

describe("shared household finances",()=>{
  let root:string;
  let service:typeof import("../services/householdService.js");
  let contexts:typeof import("../services/workspaceContext.js");
  let companies:typeof import("../services/companiesService.js");
  let auth:typeof import("../services/authService.js");
  let workspace:import("../services/companiesService.js").Company;
  let owner:Awaited<ReturnType<typeof auth.createOwner>>;
  let partner:typeof owner;
  let readonly:typeof owner;
  let state:HouseholdState;
  beforeAll(async()=>{
    root=await fs.mkdtemp(path.join(os.tmpdir(),"comptaos-household-"));
    vi.stubEnv("WORKSPACE_PATH",root);vi.stubEnv("AUTH_ENABLED","true");
    vi.resetModules();
    companies=await import("../services/companiesService.js");
    contexts=await import("../services/workspaceContext.js");
    service=await import("../services/householdService.js");
    auth=await import("../services/authService.js");
    companies.ensureDefaultCompany();
    owner=await auth.createOwner("alice","Alice","password-test-123");
    [partner,readonly]=await Promise.all([auth.createUser("bob","Bob","password-test-123","admin",owner.id),auth.createUser("reader","Reader","password-test-123","readonly",owner.id)]);
    workspace=companies.createCompany("Foyer");workspace.kind="household";workspace.memberIds=[owner.id,partner.id,readonly.id];
    companies.saveCompanies(companies.loadCompanies().map(c=>c.id===workspace.id?workspace:c));
    state=await run(()=>service.initializeHousehold(["Alice","Bob"]));
  });
  afterAll(async()=>{vi.unstubAllEnvs();await fs.rm(root,{recursive:true,force:true});});
  function run<T>(work:()=>T,actor=owner.id):T {return contexts.workspaceContext.run({id:workspace.id,root:companies.resolveCompanyPath(workspace),kind:"household",actor,role:"admin"},work);}
  const cookie=(user:typeof owner)=>"comptaos_token="+jwt.sign({sub:user.id,role:"owner",username:user.username},auth.getJwtSecret()); // deliberately stale/forged role
  function input(accountId=state.accounts[0].id):HouseholdImport{return {accountId,format:"csv",content:"Date;Label;Amount\n2026-09-01;Courses;-100\n2026-09-01;Courses;-100",mapping:{date:"Date",label:"Label",amount:"Amount"}};}

  it("creates six editable accounts, five contexts and no invented balances",()=>{
    expect(state.accounts).toHaveLength(6);expect(state.contexts).toHaveLength(5);
    expect(service.summarize(state).balances.every(b=>b.balance===null)).toBe(true);
  });
  it("keeps repeated purchases and scopes duplicate detection to the bank account",async()=>{
    const preview=service.previewImport(state,input());expect(preview.rows).toHaveLength(2);
    state=await run(()=>service.mutateHousehold(state.revision,"import",s=>service.commitImport(s,input())));
    expect(state.transactions).toHaveLength(2);
    expect(service.previewImport(state,input()).rows.every(r=>r.duplicate==="definite")).toBe(true);
    expect(service.previewImport(state,input(state.accounts[1].id)).rows.every(r=>r.duplicate===null)).toBe(true);
    const overlap={...input(),content:"Date;Label;Amount\n2026-09-01;Courses;-100"};
    expect(service.previewImport(state,overlap).rows[0].duplicate).toBe("possible");
  });
  it("allocates a bank movement exactly across household and both activities",async()=>{
    const t=state.transactions[0];
    const contextsIds=[state.contexts[0].id,...state.contexts.filter(c=>c.kind==="activity").map(c=>c.id)];
    const allocations=contextsIds.map((contextId,i)=>({contextId,category:"Internet",cents:[-6000,-2500,-1500][i]}));
    state=await run(()=>service.mutateHousehold(state.revision,"allocate",s=>service.editTransaction(s,t.id,{allocations,reviewed:true},t.revision)));
    expect(service.summarize(state,{contextId:contextsIds[1]}).expenses).toBe(2500);
    expect(service.summarize(state).expenses).toBe(20000);
    expect(()=>service.validateAllocations(state,[{...allocations[0],cents:-9999}],-10000)).toThrow(/somme/);
    const csv=service.exportHousehold(state,"allocations",contextsIds[1]);
    expect(csv).toContain('"-25.00"');expect(csv).not.toContain('"-60.00"');
    const reloaded=await run(()=>service.loadHousehold());expect(reloaded.transactions[0].source).toEqual(t.source);
  });
  it("protects imported source amounts and rejects a stale concurrent edit",async()=>{
    const before=state;
    const t=state.transactions[0];
    await expect(run(()=>service.mutateHousehold(state.revision,"bad",s=>service.editTransaction(s,t.id,{cents:1},t.revision)))).rejects.toThrow(/conservées/);
    const attempts=await Promise.allSettled([
      run(()=>service.mutateHousehold(before.revision,"alice",s=>service.editTransaction(s,t.id,{notes:"Alice"},t.revision)),owner.id),
      run(()=>service.mutateHousehold(before.revision,"bob",s=>service.editTransaction(s,t.id,{notes:"Bob"},t.revision)),partner.id)
    ]);
    expect(attempts.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    expect(attempts.filter(r=>r.status==="rejected")).toHaveLength(1);
    state=await run(()=>service.loadHousehold());expect(state.history[state.history.length-1].actor).toBe(owner.id);
  });
  it("matches transfers once, tracks contributions and protects paired movements",async()=>{
    state=await run(()=>service.mutateHousehold(state.revision,"transfer-fixture",s=>{
      s.transactions.push(service.makeTransaction(s,{accountId:s.accounts[0].id,date:"2026-09-02",label:"Vers commun",cents:-80000}));
      s.transactions.push(service.makeTransaction(s,{accountId:s.accounts[4].id,date:"2026-09-03",label:"Depuis Alice",cents:80000}));
    }));
    const [from,to]=state.transactions.slice(-2);
    expect(service.transferSuggestions(state)).toContainEqual({fromId:from.id,toId:to.id});
    state=await run(()=>service.mutateHousehold(state.revision,"match",s=>service.matchTransfer(s,from.id,to.id)));
    const summary=service.summarize(state);
    expect(summary.income).toBe(0);expect(summary.expenses).toBe(20000);
    expect(summary.contributions[0].paid).toBe(80000);
    expect(service.exportHousehold(state,"allocations")).not.toContain("Vers commun");
    expect(service.exportHousehold(state,"transactions")).toContain("Vers commun");
    await expect(run(()=>service.mutateHousehold(state.revision,"delete",s=>service.editTransaction(s,from.id,{deleted:true},from.revision)))).rejects.toThrow(/Dissociez/);
    const baseline=structuredClone(state);baseline.accounts[4].opening={date:"2026-09-01",cents:10000};
    expect(service.summarize(baseline).balances[4].balance).toBe(90000);
  });
  it("subtracts refunds from expense totals",async()=>{
    const fixture=structuredClone(state);
    fixture.transactions.push(service.makeTransaction(fixture,{accountId:fixture.accounts[0].id,date:"2026-09-05",label:"Remboursement",cents:2000,nature:"refund",allocations:[{contextId:fixture.contexts[0].id,category:"Courses",cents:2000}]}));
    expect(service.summarize(fixture).expenses).toBe(18000);
  });
  it("recovers an interrupted multi-file import before serving reads",async()=>{
    const folder=companies.resolveCompanyPath(workspace);
    const {transactions,...metadata}=state;
    const updated={...transactions[0],notes:"Recovered",revision:transactions[0].revision+1};
    await fs.writeFile(path.join(folder,"household.pending.json"),JSON.stringify({state:{...metadata,revision:state.revision+1,transactionIds:transactions.map(t=>t.id)},changed:[updated]}));
    state=await run(()=>service.loadHousehold());
    expect(state.transactions[0].notes).toBe("Recovered");
    await expect(fs.access(path.join(folder,"household.pending.json"))).rejects.toThrow();
  });
  it("enforces live user roles and membership on simultaneous HTTP requests",async()=>{
    const {registerAccessControl}=await import("../services/workspaceAccess.js");
    const {householdRoutes}=await import("../routes/household.js");
    const {filesRoutes}=await import("../routes/files.js");
    const {companiesRoutes}=await import("../routes/companies.js");
    const app=Fastify();registerAccessControl(app);
    await app.register(householdRoutes,{prefix:"/api/workspaces/:workspaceId/household"});
    await app.register(filesRoutes,{prefix:"/api/workspaces/:workspaceId/files"});
    await app.register(companiesRoutes,{prefix:"/api/companies"});
    const url="/api/workspaces/"+workspace.id+"/household";
    const both=await Promise.all([owner,partner].map(u=>app.inject({method:"GET",url,headers:{cookie:cookie(u)}})));
    expect(both.map(r=>r.statusCode)).toEqual([200,200]);
    expect(both[0].json().revision).toBe(state.revision);
    expect((await app.inject({method:"GET",url})).statusCode).toBe(401);
    expect((await app.inject({method:"POST",url:url+"/commands",headers:{cookie:cookie(readonly)},payload:{revision:state.revision,action:"transaction",transaction:{}}})).statusCode).toBe(403);
    expect((await app.inject({method:"GET",url:"/api/workspaces/"+workspace.id+"/files/content?path=auth.json",headers:{cookie:cookie(owner)}})).statusCode).toBe(403);
    expect((await app.inject({method:"GET",url:"/api/workspaces/default/files/content?path=auth.json",headers:{cookie:cookie(owner)}})).statusCode).toBe(403);
    const current=await fs.readFile(path.join(root,"_active.json"),"utf8");
    await app.inject({method:"PUT",url:"/api/companies/active",headers:{cookie:cookie(partner)},payload:{companyId:workspace.id}});
    expect(await fs.readFile(path.join(root,"_active.json"),"utf8")).toBe(current);
    await auth.updateUser(partner.id,{active:false},owner.id,"owner");
    expect((await app.inject({method:"GET",url,headers:{cookie:cookie(partner)}})).statusCode).toBe(401);
    await app.close();
  });
  it("backs up and restores receipts, accounts and users, rejecting nonempty restore targets",async()=>{
    const backupRoot=await fs.mkdtemp(path.join(os.tmpdir(),"comptaos-backup-"));
    const destination=path.join(backupRoot,"restored");
    vi.stubEnv("BACKUP_PATH",backupRoot);
    const {createBackup,restoreBackup}=await import("../services/backupService.js");
    await fs.writeFile(path.join(companies.resolveCompanyPath(workspace),"attachments","receipt.pdf"),"%PDF-test");
    const result=await createBackup();
    await restoreBackup(path.join(backupRoot,result.file!),destination);
    expect(await fs.readFile(path.join(destination,workspace.path,"attachments","receipt.pdf"),"utf8")).toBe("%PDF-test");
    expect(JSON.parse(await fs.readFile(path.join(destination,"auth.json"),"utf8")).users).toHaveLength(3);
    await expect(restoreBackup(path.join(backupRoot,result.file!),destination)).rejects.toThrow(/vide/);
    await fs.rm(backupRoot,{recursive:true,force:true});
  });
});
