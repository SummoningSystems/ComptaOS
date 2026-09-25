import {treasuryAccounts} from "../domain/ecosystemMetrics.js";
import {isManualRecurring} from "./manualRecurringService.js";
import {resolveVariables,type FinancialVariable} from "../domain/ecosystemVariables.js";
import {needsTransactionEvidence} from "./transactionEvidenceService.js";
import {hydrateDocuments} from "./ecosystemDocuments.js";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { atomicWriteFile } from "./atomicFile.js";
import { actorContext, workspaceContext, workspaceLock } from "./workspaceContext.js";
import { createCompany, loadCompanies, saveCompanies, resolveCompanyPath, getCompaniesRoot } from "./companiesService.js";
import { fail, validDate, previewImport, commitImport } from "./householdService.js";
import type { HouseholdState, HouseholdImport } from "../types/household.js";
import type { Ecosystem, Entity, Relation, Movement, Allocation, Treatment } from "../types/ecosystem.js";
import type { Transaction } from "../types/index.js";
import { assertMonthOpen } from "./closingService.js";
export const uid=()=>randomUUID();
const actor=()=>actorContext.getStore()??{id:"local",role:"owner"};
export function ecosystemRoot(id:string) {
  const record=loadCompanies().find(c=>c.id===id&&c.kind==="ecosystem");
  if(!record || (actor().id!=="local"&&!record.memberIds?.includes(actor().id)))fail("Écosystème inaccessible.",403);
  return resolveCompanyPath(record);
}
export function listEcosystems(){return loadCompanies().filter(c=>c.kind==="ecosystem"&&(actor().id==="local"||c.memberIds?.includes(actor().id))).map(({id,name})=>({id,name}));}
export function requireAdmin(){if(!["owner","admin"].includes(actor().role))fail("Administrateur requis.",403);}
const safeId=(s:unknown):s is string=>typeof s==="string"&&/^[a-zA-Z0-9_-]{1,100}$/.test(s);
function text(value:unknown,max=200):string {if(typeof value!=="string"||!value.trim()||value.length>max)fail("Texte invalide.");return value.trim();}
function integer(value:unknown):number {if(!Number.isSafeInteger(value))fail("Montant invalide (centimes entiers).");return value as number;}
function targetExists(s:Ecosystem,id:string){return ["root","common","unassigned"].includes(id)||s.entities.some(e=>e.id===id&&e.kind!=="account"&&!e.archived);}
export function validateAllocations(s:Ecosystem,lines:Allocation[],amount:number){
  if(!Array.isArray(lines)||!lines.length||lines.length>100)fail("Affectations requises.");
  const ids=new Set<string>();
  for(const a of lines){if(a.target==="root")a.target="common";if(!safeId(a.id)||ids.has(a.id)||!targetExists(s,a.target))fail("Affectation invalide.");ids.add(a.id);text(a.category);integer(a.cents);if(a.cents&&Math.sign(a.cents)!==Math.sign(amount))fail("Sens d’affectation invalide.");}
  if(lines.reduce((n,a)=>n+a.cents,0)!==amount)fail("La somme des affectations doit égaler le mouvement.");
}
async function materialize(root:string,state:Ecosystem){
  await workspaceLock(path.join(getCompaniesRoot(),"_registry"),async()=>{
    const registry=loadCompanies();
    for(const e of state.entities.filter(e=>e.kind==="company"&&e.workspaceId)){
      const existing=registry.find(c=>c.id===e.workspaceId);
      if(existing){existing.ecosystemId=state.id;existing.name=e.name;}
      else registry.push({id:e.workspaceId!,name:e.name,path:"companies/"+e.workspaceId,createdAt:new Date().toISOString(),ecosystemId:state.id,memberIds:[]});
    }
    saveCompanies(registry);
  });
  await atomicWriteFile(path.join(root,"ecosystem.json"),JSON.stringify(state));
  await fs.unlink(path.join(root,"ecosystem.pending.json"));
}
async function loadUnlocked(id:string):Promise<Ecosystem>{
  const root=ecosystemRoot(id);
  const journal=await fs.readFile(path.join(root,"ecosystem.pending.json"),"utf8").catch(e=>{if(e.code!=="ENOENT")throw e;return null;});
  if(journal){const pending=JSON.parse(journal) as Ecosystem;if(pending.id!==id||![1,2].includes(pending.schemaVersion))fail("Journal de récupération invalide.",503);await materialize(root,pending);}
  const raw=JSON.parse(await fs.readFile(path.join(root,"ecosystem.json"),"utf8")) as Ecosystem;
  if(![1,2].includes(raw.schemaVersion)||raw.id!==id||!Number.isSafeInteger(raw.revision))fail("Format écosystème non pris en charge.",503);
  if(raw.schemaVersion===1){
    // Preserve the original bytes before upgrading; retrying after a crash is safe.
    const original=await fs.readFile(path.join(root,"ecosystem.json"),"utf8");
    await fs.writeFile(path.join(root,"ecosystem.v1.backup.json"),original,{flag:"wx",mode:0o600}).catch(e=>{if(e.code!=="EEXIST")throw e;});
    const review:string[]=[];
    for(const m of raw.movements)for(const a of m.allocations)if(a.target==="root"){
      a.target=a.category==="À classer"?"unassigned":"common";
      if(a.target==="unassigned")review.push("movement:"+m.id);
    }
    for(const e of raw.entities)if(e.kind==="account"&&(!e.defaultTarget||e.defaultTarget==="root")){e.defaultTarget="unassigned";review.push("account:"+e.id);}
    for(const b of raw.budgets)if(b.target==="root")b.target="common";
    for(const r of raw.recurring)for(const a of r.allocations)if(a.target==="root")a.target="common";
    raw.schemaVersion=2;raw.revision++;raw.migration={at:new Date().toISOString(),from:1,review:[...new Set(review)]};
    raw.history.push({at:raw.migration.at,actor:"migration",action:"schema-v2",details:raw.migration});
    await atomicWriteFile(path.join(root,"ecosystem.pending.json"),JSON.stringify(raw));await materialize(root,raw);
  }
  const planningBefore=JSON.stringify(raw);const migrated:string[]=[];
  for(const company of raw.entities.filter(e=>e.kind==="company"&&e.workspaceId)){
    const record=loadCompanies().find(c=>c.id===company.workspaceId);if(!record)continue;
    for(const kind of ["recurring","budgets"] as const){
      const key=kind+":"+company.id;if(raw.planningMigrated?.includes(key))continue;
      const file=path.join(resolveCompanyPath(record),"settings",kind==="recurring"?"manual_recurring.json":"budgets.json");
      const content=await fs.readFile(file,"utf8").catch(e=>{if(e.code!=="ENOENT")throw e;return null;});if(content===null)continue;
      const entries=JSON.parse(content) as unknown[];if(!Array.isArray(entries))fail("Prévisions historiques invalides : "+company.name,503);
      if(kind==="recurring")for(const entry of entries){
        if(!isManualRecurring(entry))fail("Échéance historique invalide : "+company.name,503);
        if(raw.recurring.some(r=>r.id===entry.id))continue;
        const cents=Math.round(entry.amount*100);
        raw.recurring.push({id:entry.id,label:entry.label,accountId:"",cents,allocations:[{id:uid(),target:company.id,category:entry.category,cents:-cents}],frequency:entry.frequency==="mensuel"?"monthly":entry.frequency==="trimestriel"?"quarterly":"yearly",nextDate:entry.nextPayment,endDate:entry.endPayment,active:entry.active,decision:entry.decision,simulatedCents:entry.simulatedAmount===undefined?undefined:Math.round(entry.simulatedAmount*100),notes:entry.notes,originCompany:company.id});
      }
      else for(const entry of entries){const b=entry as {category:string;monthlyLimit:number};if(!b||typeof b.category!=="string"||!Number.isFinite(b.monthlyLimit)||b.monthlyLimit<0)fail("Budget historique invalide : "+company.name,503);if(!raw.budgets.some(v=>v.target===company.id&&v.category===b.category))raw.budgets.push({id:uid(),target:company.id,category:b.category,cents:Math.round(b.monthlyLimit*100),basis:"accounting"});}
      raw.planningMigrated=[...(raw.planningMigrated??[]),key];migrated.push(key);
    }
  }
  if(migrated.length){
    await fs.writeFile(path.join(root,"ecosystem.planning.backup.json"),planningBefore,{flag:"wx",mode:0o600}).catch(e=>{if(e.code!=="EEXIST")throw e;});
    raw.revision++;raw.history.push({at:new Date().toISOString(),actor:"migration",action:"planning-migration",details:{sources:migrated,review:raw.recurring.filter(r=>!r.accountId).map(r=>r.id)}});
    await atomicWriteFile(path.join(root,"ecosystem.pending.json"),JSON.stringify(raw));await materialize(root,raw);
  }
  await hydrateDocuments(raw);return raw;
}
export async function loadEcosystem(id:string){const root=ecosystemRoot(id);return workspaceLock(root,()=>loadUnlocked(id));}
export async function createEcosystem(name:string){
  requireAdmin();name=text(name);
  return workspaceLock(path.join(getCompaniesRoot(),"_registry"),async()=>{
    const record=createCompany(name,false);record.kind="ecosystem";record.memberIds=[actor().id];
    const state:Ecosystem={schemaVersion:2,id:record.id,name,revision:0,entities:[],relations:[],movements:[],transfers:[],documents:[],treatments:[],budgets:[],recurring:[],feeds:[],imports:[],history:[]};
    // Publish the registry only after a complete state exists.
    await atomicWriteFile(path.join(resolveCompanyPath(record),"ecosystem.json"),JSON.stringify(state));
    saveCompanies([...loadCompanies(),record]);return state;
  });
}
function affectedScopes(before:Ecosystem,after:Ecosystem){
 const ids=new Set<string>(["root"]);
 function changed<T extends {id:string}>(a:T[],b:T[],scopes:(v:T)=>string[]){const old=new Map(a.map(v=>[v.id,v]));const next=new Map(b.map(v=>[v.id,v]));for(const id of new Set([...old.keys(),...next.keys()]))if(JSON.stringify(old.get(id))!==JSON.stringify(next.get(id)))for(const value of [old.get(id),next.get(id)])if(value)for(const scope of scopes(value))ids.add(scope);}
 changed(before.entities,after.entities,e=>[e.id]);changed(before.relations,after.relations,r=>[r.from,r.to]);
 changed(before.movements,after.movements,m=>[m.accountId,...m.allocations.map(a=>a.target)]);
 changed(before.documents,after.documents,d=>[...d.links,...d.movementIds.flatMap(id=>{const m=after.movements.find(m=>m.id===id);return m?[m.accountId,...m.allocations.map(a=>a.target)]:[];})]);
 changed(before.budgets,after.budgets,b=>[b.target]);changed(before.recurring,after.recurring,r=>[r.accountId,...r.allocations.map(a=>a.target)]);
 changed(before.variables??[],after.variables??[],v=>[v.scope]);
 changed(before.treatments.map(t=>({...t,id:t.transaction.id})),after.treatments.map(t=>({...t,id:t.transaction.id})),t=>[t.companyId]);return [...ids].filter(Boolean);
}
export async function mutateEcosystem(id:string,revision:number|undefined,action:string,work:(s:Ecosystem)=>unknown|Promise<unknown>){
  if(actor().role==="readonly")fail("Accès en lecture seule.",403);
  const root=ecosystemRoot(id);
  return workspaceLock(root,async()=>{
    const s=await loadUnlocked(id);
    if(revision!==undefined&&revision!==s.revision)fail("Cet espace a été modifié. Rechargez et vérifiez vos changements.",409);
    const before=structuredClone(s);
    const details=await work(s);
    for(const m of s.movements)refreshTreatments(s,m);
    for(const old of before.treatments){const next=s.treatments.find(t=>t.transaction.id===old.transaction.id);if(JSON.stringify(old)!==JSON.stringify(next)){await companyOpen(before,old);if(old.transaction.status==="validated"&&action!=="reopen")fail("Rouvrez les traitements validés avant cette modification.",409);}}
    for(const next of s.treatments){const old=before.treatments.find(t=>t.transaction.id===next.transaction.id);if(JSON.stringify(next)!==JSON.stringify(old)&&action!=="legacy-workspace-migration")await companyOpen(s,next);}
    s.revision++;s.history.push({at:new Date().toISOString(),actor:actor().id,scopeIds:affectedScopes(before,s),action,details:details??null});
    // All linked movements and accounting treatments share one atomic commit.
    await atomicWriteFile(path.join(root,"ecosystem.pending.json"),JSON.stringify(s));
    await materialize(root,s);return s;
  });
}
export function relationValid(r:Relation,entities:Entity[],relations:Relation[]){
  const a=entities.find(e=>e.id===r.from),b=entities.find(e=>e.id===r.to);
  if(!a||!b||a.id===b.id||a.archived||b.archived)return false;
  if(r.kind==="holder")return a.kind!=="account"&&b.kind==="account";
  if(r.kind==="activity")return a.kind==="person"&&b.kind==="company";
  if(r.kind==="usage")return a.kind==="account"&&b.kind==="company";
  if(r.kind!=="subsidiary"||a.kind!=="company"||b.kind!=="company")return false;
  const todo=[b.id],seen=new Set<string>();while(todo.length){const id=todo.pop()!;if(id===a.id)return false;if(seen.has(id))continue;seen.add(id);todo.push(...relations.filter(x=>x.kind==="subsidiary"&&x.from===id).map(x=>x.to));}return true;
}
async function companyOpen(s:Ecosystem,t:Treatment){
  const company=s.entities.find(e=>e.id===t.companyId);const record=loadCompanies().find(c=>c.id===company?.workspaceId);
  if(record)await workspaceContext.run({id:record.id,root:resolveCompanyPath(record),kind:"business",actor:actor().id,role:actor().role},()=>assertMonthOpen(t.transaction.date));
}
function refreshTreatments(s:Ecosystem,m:Movement){
  const transfer=s.transfers.find(t=>t.fromId===m.id||t.toId===m.id);
  const companiesFor=(account:string,at=m.date)=>s.entities.filter(e=>e.kind==="company"&&e.accountingEnabled&&treasuryAccounts(s,e.id,at).some(a=>a.id===account));
  const other=transfer?s.movements.find(x=>x.id===(transfer.fromId===m.id?transfer.toId:transfer.fromId)):undefined;
  const wanted=m.deleted||m.pending||m.duplicateCandidates?.length?[]:transfer?companiesFor(m.accountId).filter(e=>m.cents<0||!other||!companiesFor(other.accountId,other.date).some(c=>c.id===e.id)).map(e=>({id:"transfer-"+transfer.id+"-"+e.id,target:e.id,cents:m.cents,category:"internal_transfer"})):m.allocations.filter(a=>s.entities.some(e=>e.id===a.target&&e.kind==="company"&&e.accountingEnabled));
  s.treatments=s.treatments.filter(t=>t.movementId!==m.id||wanted.some(a=>a.id===t.allocationId));
  for(const a of wanted){
    const old=s.treatments.find(t=>t.movementId===m.id&&t.allocationId===a.id);
    if(old){if(old.companyId!==a.target||old.transaction.amount_ttc!==a.cents/100||old.transaction.date!==m.date){old.companyId=a.target;Object.assign(old.transaction,{amount_ttc:a.cents/100,amount_ht:a.cents/100,vat:0,vat_rate:0,vat_splits:[],date:m.date,status:"pending",reconciled:false});}continue;}
    s.treatments.push({companyId:a.target,movementId:m.id,allocationId:a.id,transferId:transfer?.id,transaction:{id:uid(),date:m.date,label:m.label,amount_ttc:a.cents/100,amount_ht:a.cents/100,vat:0,vat_rate:0,currency:"EUR",category:transfer?"internal_transfer":"misc",account:"",status:"pending",notes:"",transferId:transfer?.id,sourceAllocation:transfer?undefined:{ecosystemId:s.id,movementId:m.id,allocationId:a.id},revision:1}});
  }
}
export function makeMovement(s:Ecosystem,input:Partial<Movement>):Movement {
  const account=s.entities.find(e=>e.id===input.accountId&&e.kind==="account"&&!e.archived);if(!account)fail("Compte actif requis.");
  if(!validDate(input.date!))fail("Date invalide.");const cents=integer(input.cents);
  const m:Movement={id:uid(),accountId:account.id,date:input.date!,label:text(input.label,1000),cents,currency:"EUR",allocations:input.allocations??[{id:uid(),target:account.defaultTarget??"unassigned",category:"À classer",cents}],revision:1,reviewed:input.reviewed===true,nature:input.nature??(cents<0?"expense":"income"),notes:typeof input.notes==="string"?input.notes.slice(0,10000):""};
  if(input.tags!==undefined){if(!Array.isArray(input.tags)||input.tags.length>30)fail("Étiquettes invalides.");m.tags=[...new Set(input.tags.map(t=>text(t,60)))];}
  if(!["income","expense","refund"].includes(m.nature))fail("Nature invalide.");validateAllocations(s,m.allocations,cents);return m;
}
function household(s:Ecosystem):HouseholdState {
  return {schemaVersion:1,revision:s.revision,people:s.entities.filter(e=>e.kind==="person").map(e=>({id:e.id,name:e.name})),contexts:[{id:"root",name:"Vie commune (ancien)",kind:"shared"},{id:"common",name:"Vie commune",kind:"shared"},{id:"unassigned",name:"Non affecté",kind:"shared"},...s.entities.filter(e=>e.kind!=="account").map(e=>({id:e.id,name:e.name,kind:e.kind==="company"?"activity" as const:"personal" as const}))],accounts:s.entities.filter(e=>e.kind==="account").map(e=>({id:e.id,name:e.name,ownerIds:s.relations.filter(r=>r.kind==="holder"&&r.to===e.id).map(r=>r.from),currency:"EUR",purpose:"personal",defaultContextId:e.defaultTarget??"unassigned",archived:e.archived,opening:e.opening})),transactions:s.movements.map(m=>({...m,allocations:m.allocations.map(a=>({contextId:a.target,category:a.category,cents:a.cents})),source:m.source?.provider==="file"?m.source.raw as HouseholdState["transactions"][number]["source"]:undefined,attachments:[],updatedAt:"",updatedBy:""})),transfers:s.transfers,budgets:[],recurring:[],imports:s.imports,history:[]};
}
export function previewEcosystemImport(s:Ecosystem,input:HouseholdImport){
  const preview=previewImport(household(s),input);
  for(const row of preview.rows)if(!row.duplicate&&s.movements.some(m=>!m.deleted&&m.accountId===input.accountId&&m.source?.provider==="powens"&&m.date===row.date&&m.cents===row.cents))row.duplicate="possible";
  return preview;
}
export function importMovements(s:Ecosystem,input:HouseholdImport){
  const h=household(s),before=new Set(h.transactions.map(t=>t.id));const result=commitImport(h,{...input,selectedRows:input.selectedRows??previewEcosystemImport(s,input).rows.filter(r=>!r.duplicate).map(r=>r.index)});
  for(const t of h.transactions.filter(t=>!before.has(t.id))){const m=makeMovement(s,{...t,source:undefined,allocations:t.allocations.map(a=>({id:uid(),target:a.contextId,category:a.category,cents:a.cents}))});m.source={provider:"file",key:createHash("sha256").update(JSON.stringify(t.source)).digest("hex"),raw:t.source};s.movements.push(m);refreshTreatments(s,m);}
  s.imports=h.imports;return result;
}
export async function ecosystemCommand(id:string,input:Record<string,unknown>){
  if(!Number.isSafeInteger(input.revision))fail("Révision requise.");
  return mutateEcosystem(id,input.revision as number,text(input.action),async s=>{
    switch(input.action){
      case "variable":{
        const v=input.variable as FinancialVariable;
        if(!v||!safeId(v.id)||!["income","expenses","net","balance","bank_debits","bank_credits","accounting_revenue_ht","accounting_expenses_ht","vat","forecast_expenses"].includes(v.metric)||typeof v.period!=="string"||typeof v.scope!=="string"||v.formula!==undefined&&typeof v.formula!=="string")fail("Variable invalide.");
        const next:FinancialVariable={id:v.id,name:text(v.name),scope:v.scope,metric:v.metric,period:v.period,category:v.category?text(v.category):undefined,formula:v.formula?.trim()||undefined};
        const list=[...(s.variables??[]).filter(x=>x.id!==v.id),next];
        const result=resolveVariables(s,list).find(x=>x.id===v.id)!;
        // Unknown bank balances are legitimate states, but malformed formulas/cycles are not saved.
        if(next.formula&&result.error)fail(result.error);
        s.variables=list;return next;
      }
      case "delete-variable":s.variables=(s.variables??[]).filter(v=>v.id!==input.id);return {id:input.id};
      case "entity":{
        const v=input.entity as Entity;if(!v||(!safeId(v.id)||["root","common","unassigned"].includes(v.id))||!["person","company","account"].includes(v.kind))fail("Élément invalide.");
        const old=s.entities.find(e=>e.id===v.id);if(old&&old.kind!==v.kind)fail("Le type ne peut pas changer.");
        if(old&&old.revision!==v.revision)fail("Élément modifié. Rechargez avant de modifier ses propriétés.",409);
        const e:Entity={id:v.id,kind:v.kind,name:text(v.name),archived:v.archived===true,revision:(old?.revision??0)+1};
        if(v.kind==="company"){
          e.companyType=text(v.companyType??"Entreprise");e.accountingEnabled=v.accountingEnabled===true;e.vatEnabled=e.accountingEnabled&&v.vatEnabled===true;
          if(old?.accountingEnabled&&!e.accountingEnabled&&s.treatments.some(t=>t.companyId===e.id))fail("Conservez la comptabilité tant que des traitements existent.");
          e.workspaceId=old?.workspaceId;
          if(!e.workspaceId){const record=createCompany(e.name,false);e.workspaceId=record.id;}
        }
        if(v.kind==="account"){
          e.usage=text(v.usage??"Autre");
          e.bankIdentifier=v.bankIdentifier?.replace(/\s/g,"").toUpperCase();
          if(e.bankIdentifier&&(!/^[A-Z0-9]{15,34}$/.test(e.bankIdentifier)||s.entities.some(other=>other.id!==e.id&&other.bankIdentifier===e.bankIdentifier)))fail("Identifiant bancaire invalide ou déjà associé à un autre compte.");e.defaultTarget=v.defaultTarget==="root"?"common":v.defaultTarget??"unassigned";if(!targetExists(s,e.defaultTarget))fail("Affectation par défaut invalide.");
          e.treasuryAssignments=v.treasuryAssignments??old?.treasuryAssignments;
          if(e.treasuryAssignments){
            if(!Array.isArray(e.treasuryAssignments)||e.treasuryAssignments.length>100)fail("Affectations de trésorerie invalides.");
            for(const a of e.treasuryAssignments){
              if(!s.entities.some(c=>c.id===a.companyId&&c.kind==="company"&&!c.archived)||!validDate(a.from)||a.to&&(!validDate(a.to)||a.to<a.from))fail("Entreprise et dates de trésorerie invalides.");
            }
            const ordered=[...e.treasuryAssignments].sort((a,b)=>a.from.localeCompare(b.from));
            if(ordered.some((a,i)=>i>0&&a.from<=(ordered[i-1].to??"9999-12-31")))fail("Un compte ne peut contribuer à deux trésoreries sur la même période.");
          }
          e.opening=undefined;
          if(v.opening){if(!validDate(v.opening.date))fail("Date du solde invalide.");e.opening={date:v.opening.date,cents:integer(v.opening.cents)};}
        }
        const before=old?structuredClone(old):null;
        if(old)Object.assign(old,e);else s.entities.push(e);
        if(e.accountingEnabled)for(const m of s.movements)refreshTreatments(s,m);
        return {before,after:e};
      }
      case "relation":{const r={...(input.relation as Relation),id:uid()};if(!relationValid(r,s.entities,s.relations)||s.relations.some(x=>x.from===r.from&&x.to===r.to&&x.kind===r.kind))fail("Relation invalide, existante ou cyclique.");s.relations.push(r);return r;}
      case "disconnect":{const r=s.relations.find(r=>r.id===input.id);s.relations=s.relations.filter(r=>r.id!==input.id);return r;}
      case "movement":{
        const old=s.movements.find(m=>m.id===input.id);const v=input.movement as Partial<Movement>;
        if(input.id&&!old)fail("Mouvement introuvable.",404);
        if(old){
          if(input.expectedRevision!==old.revision)fail("Mouvement modifié par un autre utilisateur.",409);
          if(old.source&&(v.date&&v.date!==old.date||v.cents!==undefined&&v.cents!==old.cents||v.accountId&&v.accountId!==old.accountId))fail("Les données bancaires importées sont conservées.");
          if(s.transfers.some(t=>t.fromId===old.id||t.toId===old.id))fail("Dissociez le virement avant modification.",409);
          for(const t of s.treatments.filter(t=>t.movementId===old.id)){await companyOpen(s,t);if(t.transaction.status==="validated")fail("Rouvrez le traitement comptable avant de modifier le mouvement.",409);}
          const next=makeMovement(s,{...old,...v});Object.assign(old,next,{id:old.id,source:old.source,revision:old.revision+1,deleted:v.deleted===true});refreshTreatments(s,old);return old;
        }
        const m=makeMovement(s,v);s.movements.push(m);refreshTreatments(s,m);return m;
      }
      case "bulk-movement":{
        const items=input.items as {id:string;revision:number}[];
        if(!Array.isArray(items)||!items.length||items.length>500||new Set(items.map(i=>i.id)).size!==items.length)fail("Sélection invalide (500 mouvements maximum).");
        for(const item of items){
          const m=s.movements.find(m=>m.id===item.id&&!m.deleted);if(!m||m.revision!==item.revision)fail("La sélection a changé. Rechargez avant de confirmer.",409);
          if(s.transfers.some(t=>t.fromId===m.id||t.toId===m.id)||s.treatments.some(t=>t.movementId===m.id&&t.transaction.status==="validated"))fail("Retirez les virements et les traitements validés de la sélection.",409);
          if(input.target!==undefined){const allocations=[{id:uid(),target:String(input.target),category:text(input.category),cents:m.cents}];validateAllocations(s,allocations,m.cents);m.allocations=allocations;}
          if(typeof input.reviewed==="boolean")m.reviewed=input.reviewed;
          m.revision++;
        }
        return {ids:items.map(i=>i.id),target:input.target,category:input.category,reviewed:input.reviewed};
      }
      case "duplicate":{
        const m=s.movements.find(m=>m.id===input.id&&!m.deleted);if(!m?.duplicateCandidates?.length)fail("Aucun doublon en attente.");
        if(m.revision!==input.expectedRevision)fail("Mouvement modifié.",409);
        if(input.keepId){const keep=s.movements.find(x=>x.id===input.keepId&&!x.deleted);if(!keep||!m.duplicateCandidates.includes(keep.id)||keep.accountId!==m.accountId||keep.cents!==m.cents||keep.date!==m.date)fail("Mouvements incompatibles.");
          keep.sources=[...(keep.sources??[]),...(m.source?[m.source]:[]),...(m.sources??[])];keep.revision++;m.deleted=true;
          for(const doc of s.documents)doc.movementIds=[...new Set(doc.movementIds.map(id=>id===m.id?keep.id:id))];
        }
        m.duplicateCandidates=[];m.revision++;return {id:m.id,kept:input.keepId??m.id};
      }
      case "source-change":{
        const m=s.movements.find(m=>m.id===input.id);if(!m?.sourceChange)fail("Aucune correction en attente.");
        if(m.revision!==input.expectedRevision)fail("Mouvement modifié.",409);
        if(s.transfers.some(t=>t.fromId===m.id||t.toId===m.id))fail("Dissociez le virement avant correction.",409);
        for(const t of s.treatments.filter(t=>t.movementId===m.id)){await companyOpen(s,t);if(t.transaction.status==="validated")fail("Rouvrez les traitements avant correction.",409);}
        const change=m.sourceChange;const before=structuredClone(m);Object.assign(m,change,{sourceChange:undefined,reviewed:false,revision:m.revision+1,allocations:change.cents===m.cents?m.allocations:[{id:uid(),target:"unassigned",category:"À classer",cents:change.cents}]});return {before,after:m};
      }
      case "import":return importMovements(s,input.import as HouseholdImport);
      case "transfer":{
        const a=s.movements.find(m=>m.id===input.fromId&&!m.deleted&&!m.pending&&!m.duplicateCandidates?.length),b=s.movements.find(m=>m.id===input.toId&&!m.deleted&&!m.pending&&!m.duplicateCandidates?.length);
        if(!a||(input.toId&&!b)||b&&(a.accountId===b.accountId||a.cents!==-b.cents)||!a.cents)fail("Deux comptes distincts et des montants opposés sont requis.");
        if(s.transfers.some(t=>[t.fromId,t.toId].some(v=>v&&[a.id,b?.id].includes(v))))fail("Mouvement déjà rapproché.",409);
        for(const t of s.treatments.filter(t=>[a.id,b?.id].includes(t.movementId))){await companyOpen(s,t);if(t.transaction.status==="validated")fail("Rouvrez les traitements avant de confirmer le virement.",409);}
        const t={id:uid(),fromId:a.id,toId:b?.id};s.transfers.push(t);refreshTreatments(s,a);if(b)refreshTreatments(s,b);return t;
      }
      case "unlink":{const t=s.transfers.find(t=>t.id===input.id);for(const treatment of s.treatments.filter(v=>v.transferId===input.id)){await companyOpen(s,treatment);if(treatment.transaction.status==="validated")fail("Rouvrez les traitements du virement avant de le dissocier.",409);}s.transfers=s.transfers.filter(t=>t.id!==input.id);for(const m of s.movements.filter(m=>m.id===t?.fromId||m.id===t?.toId))refreshTreatments(s,m);return t;}
      case "budget":{const v=input.budget as Ecosystem["budgets"][number];if(!v||!targetExists(s,v.target)||integer(v.cents)<0)fail("Budget invalide.");const row={id:v.id||uid(),target:v.target==="root"?"common":v.target,category:text(v.category),cents:v.cents,basis:v.basis==="accounting"?"accounting" as const:"allocations" as const};const i=s.budgets.findIndex(b=>b.id===row.id);if(i<0)s.budgets.push(row);else s.budgets[i]=row;return row;}
      case "delete-budget":s.budgets=s.budgets.filter(b=>b.id!==input.id);return input.id;
      case "recurring":{const v=input.recurring as Ecosystem["recurring"][number];if(!v||!s.entities.some(e=>e.id===v.accountId&&e.kind==="account"&&!e.archived)||integer(v.cents)<=0||!validDate(v.nextDate)||!["monthly","quarterly","yearly"].includes(v.frequency))fail("Échéance invalide.");if(v.endDate&&(!validDate(v.endDate)||v.endDate<v.nextDate)||v.decision&&!["keep","reduce","cancel","planned"].includes(v.decision)||v.simulatedCents!==undefined&&integer(v.simulatedCents)<0)fail("Scénario invalide.");validateAllocations(s,v.allocations,-v.cents);const row={...v,id:v.id||uid(),label:text(v.label),active:v.active===true};const i=s.recurring.findIndex(r=>r.id===row.id);if(i<0)s.recurring.push(row);else s.recurring[i]=row;return row;}
      case "document":{const d=s.documents.find(d=>d.id===input.id);if(!d)fail("Document introuvable.",404);const v=input.document as typeof d;if(!Array.isArray(v.links)||v.links.some(id=>!s.entities.some(e=>e.id===id))||!Array.isArray(v.movementIds)||v.movementIds.some(id=>!s.movements.some(m=>m.id===id)))fail("Liens invalides.");for(const t of s.treatments.filter(t=>t.movementId&&d.movementIds.includes(t.movementId)&&!v.movementIds.includes(t.movementId))){await companyOpen(s,t);if(t.transaction.status==="validated")fail("Rouvrez le traitement avant de retirer son justificatif.",409);}
        Object.assign(d,{name:text(v.name),kind:text(v.kind),date:validDate(v.date)?v.date:d.date,links:[...new Set(v.links)],movementIds:[...new Set(v.movementIds)]});return d;}
      case "reopen":{const t=s.treatments.find(t=>t.transaction.id===input.id);if(!t)fail("Traitement introuvable.",404);await companyOpen(s,t);t.transaction.status="pending";t.transaction.reconciled=false;t.transaction.revision=(t.transaction.revision??0)+1;return t;}
      default:fail("Commande inconnue.");
    }
  });
}
export function currentEcosystemCompany(){const record=loadCompanies().find(c=>c.id===workspaceContext.getStore()?.id);return record?.ecosystemId?record:undefined;}
export async function ecosystemTransactions(){const company=currentEcosystemCompany();if(!company)return null;const s=await loadEcosystem(company.ecosystemId!);const e=s.entities.find(e=>e.workspaceId===company.id);return s.treatments.filter(t=>t.companyId===e?.id).map(t=>({...t.transaction,documentIds:s.documents.filter(d=>!!t.movementId&&d.movementIds.includes(t.movementId)).map(d=>d.id)}));}
async function applyEcosystemTransaction(s:Ecosystem,txn:Transaction,remove:boolean,companyId:string){
    const e=s.entities.find(e=>e.workspaceId===companyId);if(!e?.accountingEnabled)fail("Activez la comptabilité pour cette entreprise.");
    const old=s.treatments.find(t=>t.companyId===e.id&&t.transaction.id===txn.id);
    await assertMonthOpen(old?.transaction.date??txn.date);await assertMonthOpen(txn.date);
    if(old&&txn.revision!==old.transaction.revision)fail("Traitement modifié. Rechargez.",409);
    if(old?.transaction.status==="validated")fail("Rouvrez explicitement le traitement avant modification.",409);
    if(remove){if(old?.movementId)fail("Modifiez les affectations du mouvement pour retirer ce traitement.");s.treatments=s.treatments.filter(t=>t!==old);return txn.id;}
    if(old?.movementId){const m=s.movements.find(m=>m.id===old.movementId)!;const amount=old.transferId?m.cents:m.allocations.find(a=>a.id===old.allocationId)!.cents;if(txn.amount_ttc!==amount/100||txn.date!==m.date)fail("Le montant et la date proviennent du mouvement bancaire.");txn.sourceAllocation=old.transaction.sourceAllocation;txn.transferId=old.transferId;if(old.transferId){txn.category="internal_transfer";txn.vat=0;txn.vat_rate=0;txn.vat_splits=[];txn.amount_ht=txn.amount_ttc;}}
    else if(txn.sourceAllocation||txn.transferId)fail("Référence bancaire réservée au serveur.");
    if(txn.status==="validated"){
      const documentIds=s.documents.filter(d=>old?.movementId&&d.movementIds.includes(old.movementId)).map(d=>d.id);
      if(needsTransactionEvidence({...txn,documentIds}))fail("Ajoutez un justificatif ou une référence de facture avant validation.");
      if(!txn.settlement?.accountNumber?.match(/^\d{3,}$/)||!txn.settlement.label?.trim()||!txn.settlement.journalCode?.trim())fail("Configurez la contrepartie et le journal du règlement.");
      if(txn.transferId&&(!txn.settlement.transferAccount?.number?.match(/^\d{3,}$/)||!txn.settlement.transferAccount.label?.trim()))fail("Le compte opposé du virement doit être configuré.");
      if(txn.category==="misc")fail("Catégorie requise.");
      if(!e.vatEnabled&&txn.vat!==0)fail("TVA désactivée pour cette entreprise.");
    }
    delete txn.documentIds;
    txn.revision=(old?.transaction.revision??0)+1;
    if(old)old.transaction=txn;else s.treatments.push({companyId:e.id,transaction:txn});return txn;
}
export async function writeEcosystemTransactions(txns:Transaction[],remove=false){
 const company=currentEcosystemCompany();if(!company)return false;
 if(!txns.length||txns.length>500||new Set(txns.map(t=>t.id)).size!==txns.length)fail("Sélection invalide (500 maximum).");
 await mutateEcosystem(company.ecosystemId!,undefined,remove?"accounting-delete":"accounting",async s=>{
   for(const txn of txns)await applyEcosystemTransaction(s,txn,remove,company.id);
   return {ids:txns.map(t=>t.id)};
 });return true;
}
export async function writeEcosystemTransaction(txn:Transaction,remove=false){return writeEcosystemTransactions([txn],remove);}
