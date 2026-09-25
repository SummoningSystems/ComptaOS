import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import yaml from "yaml";
import Papa from "papaparse";
import { parseOfx, parseQif } from "./ofxQifParser.js";
import { getWorkspaceRoot } from "./fileSystem.js";
import { atomicWriteFile } from "./atomicFile.js";
import { workspaceContext, workspaceLock } from "./workspaceContext.js";
import type { Allocation, FinanceContext, HouseholdState, HouseholdTransaction, HouseholdAccount, HouseholdImport, ImportRow, HouseholdSummary } from "../types/household.js";
export type { HouseholdState } from "../types/household.js";

export function fail(message: string, statusCode = 400): never { throw Object.assign(new Error(message), { statusCode }); }
const id = () => randomUUID();
const now = () => new Date().toISOString();
const actor = () => workspaceContext.getStore()?.actor ?? "local";
const validId = (value: string) => typeof value === "string" && /^[a-zA-Z0-9_-]+$/.test(value);
export function validDate(value: string): boolean { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value; }
function cents(value: number) { if (!Number.isSafeInteger(value)) fail("Montant invalide (centimes entiers requis)."); }
const text = (value: string) => { if (typeof value !== "string" || !value.trim() || value.length > 1000) fail("Texte requis (maximum 1000 caractères)."); };
function contextExists(state: HouseholdState, value: string) { if (!state.contexts.some(c => c.id === value)) fail("Contexte introuvable."); }
function accountFor(state: HouseholdState, value: string) { const account = state.accounts.find(a => a.id === value); if (!account) fail("Compte introuvable."); return account; }
export function validateAllocations(state: HouseholdState, lines: Allocation[], amount: number) {
  if (!Array.isArray(lines) || !lines.length) fail("Une affectation est requise.");
  for (const line of lines) { contextExists(state, line.contextId); text(line.category); cents(line.cents); if (line.cents && Math.sign(line.cents) !== Math.sign(amount)) fail("Le signe des affectations doit correspondre au montant."); }
  if (lines.reduce((sum, line) => sum + line.cents, 0) !== amount) fail("La somme des affectations doit égaler le montant.");
}
function validateState(state: HouseholdState) {
  if (state.schemaVersion !== 1 || !Number.isSafeInteger(state.revision) || ![state.people,state.accounts,state.contexts,state.transactions,state.transfers,state.budgets,state.recurring,state.history,state.imports].every(Array.isArray)) fail("Données du foyer invalides ou version non prise en charge.", 503);
  const seen = new Set<string>();
  for (const transaction of state.transactions) {
    if (!validId(transaction.id) || seen.has(transaction.id) || !validDate(transaction.date) || !Number.isSafeInteger(transaction.revision)) fail("Transaction du foyer invalide.",503);
    seen.add(transaction.id); accountFor(state,transaction.accountId); cents(transaction.cents); validateAllocations(state,transaction.allocations,transaction.cents);
  }
}
async function materialize(root: string, pending: { state: Omit<HouseholdState,"transactions"> & { transactionIds: string[] }; changed: HouseholdTransaction[] }) {
  for (const transaction of pending.changed) {
    if (!validId(transaction.id)) fail("Journal de récupération invalide.",503);
    await atomicWriteFile(path.join(root,"transactions",transaction.id+".yaml"),yaml.stringify(transaction));
  }
  await atomicWriteFile(path.join(root,"household.json"),JSON.stringify(pending.state));
  await fs.unlink(path.join(root,"household.pending.json"));
}
async function loadUnlocked(): Promise<HouseholdState> {
  const root = getWorkspaceRoot();
  const journal = await fs.readFile(path.join(root,"household.pending.json"),"utf8").catch(e => { if (e.code !== "ENOENT") throw e; return null; });
  if (journal) await materialize(root,JSON.parse(journal));
  const raw = JSON.parse(await fs.readFile(path.join(root,"household.json"),"utf8"));
  if (!Array.isArray(raw.transactionIds) || raw.transactionIds.some((value: string) => !validId(value))) fail("Index du foyer invalide.",503);
  const transactions = await Promise.all(raw.transactionIds.map(async (value: string) => yaml.parse(await fs.readFile(path.join(root,"transactions",value+".yaml"),"utf8")) as HouseholdTransaction));
  const state = { ...raw, transactions } as HouseholdState;
  validateState(state);
  return state;
}
async function persist(state: HouseholdState, previous?: HouseholdState) {
  validateState(state);
  const { transactions, ...metadata } = state;
  const before = new Map(previous?.transactions.map(t => [t.id, JSON.stringify(t)]));
  const pending = { state: { ...metadata, transactionIds: transactions.map(t => t.id) }, changed: transactions.filter(t => before.get(t.id) !== JSON.stringify(t)) };
  const root = getWorkspaceRoot();
  await atomicWriteFile(path.join(root,"household.pending.json"),JSON.stringify(pending));
  await materialize(root,pending);
}
export async function initializeHousehold(names: string[]) {
  return workspaceLock(getWorkspaceRoot(),async () => {
    const people = names.map(name => ({ id: id(), name: name.trim() }));
    const shared = { id: id(), name: "Vie commune", kind: "shared" as const };
    const contexts: FinanceContext[] = [shared,...people.flatMap(p => [{ id:id(), name:p.name+" · Personnel",kind:"personal" as const,personId:p.id },{ id:id(),name:p.name+" · Activité",kind:"activity" as const,personId:p.id }])];
    const accounts: HouseholdAccount[] = people.flatMap(p => (["personal","professional"] as const).map(purpose => ({ id:id(),name:p.name+(purpose==="personal"?" · Personnel":" · Professionnel"),ownerIds:[p.id],defaultContextId:contexts.find(c=>c.personId===p.id && c.kind===(purpose==="personal"?"personal":"activity"))!.id,currency:"EUR" as const,purpose })));
    accounts.push(...(["bills","daily"] as const).map(purpose=>({id:id(),name:purpose==="bills"?"Commun · Charges fixes":"Commun · Quotidien",ownerIds:people.map(p=>p.id),defaultContextId:shared.id,currency:"EUR" as const,purpose})));
    const state: HouseholdState = {schemaVersion:1,revision:0,people,contexts,accounts,transactions:[],transfers:[],budgets:[],recurring:[],imports:[],history:[]};
    await persist(state); return state;
  });
}
export function loadHousehold() { return workspaceLock(getWorkspaceRoot(),loadUnlocked); }
export async function mutateHousehold(revision: number, action: string, work: (state: HouseholdState) => unknown | Promise<unknown>) {
  return workspaceLock(getWorkspaceRoot(),async () => {
    const state=await loadUnlocked();
    if (revision !== state.revision) fail("Cet espace a été modifié. Rechargez puis vérifiez vos changements.",409);
    const before = structuredClone(state);
    const details = await work(state);
    state.revision++;
    state.history.push({at:now(),actor:actor(),action,...(details as object ?? {})});
    await persist(state,before);
    return state;
  });
}
export function makeTransaction(state: HouseholdState, values: Partial<HouseholdTransaction>, allowArchived = false): HouseholdTransaction {
  const account=accountFor(state,values.accountId ?? "");
  if (account.archived && !allowArchived) fail("Compte archivé.");
  if (!validDate(values.date!)) fail("Date invalide.");
  text(values.label!); cents(values.cents!);
  const transaction: HouseholdTransaction={id:id(),accountId:account.id,date:values.date!,label:values.label!.trim(),cents:values.cents!,currency:"EUR",allocations:values.allocations ?? [{contextId:account.defaultContextId,category:"À classer",cents:values.cents!}],reviewed:values.reviewed===true,nature:values.nature ?? (values.cents!<0?"expense":"income"),notes:values.notes ?? "",revision:1,updatedAt:now(),updatedBy:actor(),attachments:[]};
  if (!["income","expense","refund"].includes(transaction.nature)) fail("Nature invalide.");
  validateAllocations(state,transaction.allocations,transaction.cents); return transaction;
}
export function editTransaction(state: HouseholdState, transactionId: string, patch: Partial<HouseholdTransaction>, expectedRevision: number) {
  const transaction=state.transactions.find(t=>t.id===transactionId && !t.deleted);
  if (!transaction) fail("Transaction introuvable.",404);
  if (transaction.revision !== expectedRevision) fail("Transaction modifiée par un autre utilisateur.",409);
  const matched=state.transfers.some(t=>t.fromId===transactionId || t.toId===transactionId);
  if (matched && (patch.deleted || patch.cents!==undefined && patch.cents!==transaction.cents || patch.accountId && patch.accountId!==transaction.accountId)) fail("Dissociez le virement avant cette modification.",409);
  if (transaction.source && (patch.cents!==undefined && patch.cents!==transaction.cents || patch.date && patch.date!==transaction.date || patch.accountId && patch.accountId!==transaction.accountId)) fail("Les données bancaires importées sont conservées. Supprimez puis réimportez pour les corriger.");
  const before=structuredClone(transaction);
  const allowed: (keyof HouseholdTransaction)[]=["accountId","date","label","cents","allocations","reviewed","nature","notes","deleted"];
  const changes=Object.fromEntries(Object.entries(patch).filter(([key])=>allowed.includes(key as keyof HouseholdTransaction)));
  const merged={...transaction,...changes};
  const valid=makeTransaction(state,merged,true);
  Object.assign(transaction,valid,{id:before.id,source:before.source,attachments:before.attachments,deleted:merged.deleted===true,revision:before.revision+1});
  return {recordId:transaction.id,before,after:structuredClone(transaction)};
}
export function validateAccount(state: HouseholdState, value: HouseholdAccount) {
  text(value.name); contextExists(state,value.defaultContextId);
  if (value.currency!=="EUR" || !["personal","professional","bills","daily"].includes(value.purpose) || !Array.isArray(value.ownerIds) || !value.ownerIds.length || value.ownerIds.some(owner=>!state.people.some(p=>p.id===owner))) fail("Propriétaires, devise ou usage invalides.");
  if(value.opening){if(!validDate(value.opening.date)) fail("Date de solde invalide."); cents(value.opening.cents);}
}
export function matchTransfer(state: HouseholdState, fromId: string, toId?: string) {
  const from=state.transactions.find(t=>t.id===fromId && !t.deleted);
  const to=toId ? state.transactions.find(t=>t.id===toId && !t.deleted) : undefined;
  if(!from || (toId && !to)) fail("Mouvement introuvable.");
  if(to && (to.accountId===from.accountId || to.cents!==-from.cents || !from.cents || to.id===from.id)) fail("Le virement doit relier deux comptes avec des montants opposés.");
  if(state.transfers.some(t=>[t.fromId,t.toId].some(value=>value && [fromId,toId].includes(value)))) fail("Un mouvement est déjà associé.",409);
  const record={id:id(),fromId,toId}; state.transfers.push(record); return {recordId:record.id,after:record};
}
export function transferSuggestions(state: HouseholdState) {
  const used=new Set(state.transfers.flatMap(t=>[t.fromId,t.toId]));
  const live=state.transactions.filter(t=>!t.deleted && !used.has(t.id));
  return live.filter(t=>t.cents<0).flatMap(from=>live.filter(to=>to.cents===-from.cents && to.accountId!==from.accountId && Math.abs(Date.parse(to.date)-Date.parse(from.date))<=7*86400000).map(to=>({fromId:from.id,toId:to.id})));
}
function money(raw: string): number {
  const value=String(raw).trim().replace(/[€\s\u00a0\u202f]/g,"");
  const normalized=value.includes(",")&&value.includes(".")?(value.lastIndexOf(",")>value.lastIndexOf(".")?value.replace(/\./g,"").replace(",","."):value.replace(/,/g,"")):value.replace(",",".");
  const parsed=Number(normalized);
  return value && Number.isFinite(parsed) ? Math.round(parsed*100) : NaN;
}
function importDate(raw: string): string {
  const value=raw.trim(); if(validDate(value)) return value;
  const match=/^(\d{2})[\/.-](\d{2})[\/.-](\d{4})$/.exec(value);
  return match?match[3]+"-"+match[2]+"-"+match[1]:value;
}
export function previewImport(state: HouseholdState, input: HouseholdImport) {
  accountFor(state,input.accountId);
  if(typeof input.content!=="string" || !input.content.length || input.content.length>10_000_000) fail("Fichier vide ou trop volumineux (10 Mo maximum).");
  const batchId=createHash("sha256").update(JSON.stringify([input.accountId,input.format,input.mapping,input.content])).digest("hex");
  let rows: Omit<ImportRow,"duplicate">[]=[];
  if(input.format==="csv"){
    if(!input.mapping?.date || !input.mapping.label || !(input.mapping.amount || input.mapping.debit && input.mapping.credit)) fail("Sélectionnez les colonnes date, libellé et montant.");
    const parsed=Papa.parse<Record<string,string>>(input.content,{header:true,skipEmptyLines:true});
    if(parsed.errors.length) fail("CSV invalide : "+parsed.errors[0].message);
    const mapping=input.mapping;
    rows=parsed.data.map((row,index)=>({index,date:importDate(row[mapping.date]??""),label:row[mapping.label]??"",cents:mapping.amount?money(row[mapping.amount]):money(row[mapping.credit!]||"0")-money(row[mapping.debit!]||"0"),externalId:mapping.externalId?row[mapping.externalId]||undefined:undefined}));
  }else if(input.format==="ofx" || input.format==="qif"){
    if(input.format==="ofx"){
      const currency=/<CURDEF>([^<\r\n]+)/i.exec(input.content)?.[1].trim();
      if(currency && currency!=="EUR")fail("Seuls les relevés EUR sont acceptés.");
      rows=[...input.content.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi)].map((block,index)=>{
        const t=parseOfx(block[0])[0];
        return {index,date:t?.date??"",label:t?.label??"",cents:t?.amount_ttc===undefined?NaN:Math.round(t.amount_ttc*100),externalId:/<FITID>([^<\r\n]+)/i.exec(block[1])?.[1].trim()};
      });
    }else{
      rows=input.content.split("^").filter(block=>/^D/m.test(block.trim())).map((block,index)=>{
        const t=parseQif(block+"^")[0];
        return {index,date:t?.date??"",label:t?.label??"",cents:t?.amount_ttc===undefined?NaN:Math.round(t.amount_ttc*100)};
      });
    }
  }else fail("Format non pris en charge.");
  const invalid=rows.filter(row=>!validDate(row.date)||!row.label.trim()||!Number.isSafeInteger(row.cents));
  const existing=state.transactions.filter(t=>t.accountId===input.accountId);
  const seen=new Set<string>();
  const result: ImportRow[]=rows.filter(row=>!invalid.includes(row)).map(row=>{
    const definite=state.imports.some(b=>b.id===batchId) || !!row.externalId && (seen.has(row.externalId)||existing.some(t=>t.source?.externalId===row.externalId && t.source?.format===input.format && (!t.deleted || t.source.cents===row.cents && t.source.date===row.date && t.source.label===row.label)));
    if(row.externalId)seen.add(row.externalId);
    const possible=existing.some(t=>!t.deleted && t.date===row.date && t.cents===row.cents && t.label.trim().toLowerCase()===row.label.trim().toLowerCase());
    return {...row,duplicate:definite?"definite":possible?"possible":null};
  });
  return {batchId,rows:result,invalid:invalid.length};
}
export function commitImport(state: HouseholdState,input: HouseholdImport) {
  const preview=previewImport(state,input);
  const selected=new Set(input.selectedRows ?? preview.rows.filter(row=>!row.duplicate).map(row=>row.index));
  let imported=0;
  for(const row of preview.rows){
    if(row.duplicate==="definite" || !selected.has(row.index))continue;
    const transaction=makeTransaction(state,{accountId:input.accountId,date:row.date,label:row.label,cents:row.cents});
    transaction.source={format:input.format,batchId:preview.batchId,row:row.index,externalId:row.externalId,date:row.date,label:row.label,cents:row.cents};
    state.transactions.push(transaction);imported++;
  }
  if(!state.imports.some(b=>b.id===preview.batchId))state.imports.push({id:preview.batchId,accountId:input.accountId,at:now(),imported,skipped:preview.rows.length-imported});
  return {after:{imported,skipped:preview.rows.length-imported,invalid:preview.invalid}};
}
export function summarize(state: HouseholdState, filter: {contextId?:string;accountId?:string;from?:string;to?:string}={}): HouseholdSummary {
  const includeContext=(contextId:string)=>{
    const context=state.contexts.find(c=>c.id===contextId)!;
    return !filter.contextId || filter.contextId==="all" || filter.contextId==="household" && context.kind!=="activity" || filter.contextId===context.id || filter.contextId===context.personId;
  };
  const live=state.transactions.filter(t=>!t.deleted);
  const inPeriod=(t:HouseholdTransaction)=>(!filter.from||t.date>=filter.from)&&(!filter.to||t.date<=filter.to);
  const transfers=new Set(state.transfers.flatMap(t=>[t.fromId,t.toId]));
  let income=0,expenses=0;const categories=new Map<string,number>();
  for(const transaction of live.filter(t=>inPeriod(t)&&(!filter.accountId||t.accountId===filter.accountId)&&!transfers.has(t.id))){
    for(const line of transaction.allocations.filter(a=>includeContext(a.contextId))){
      if(transaction.nature==="income" && line.cents>=0)income+=line.cents;
      else {expenses-=line.cents;categories.set(line.category,(categories.get(line.category)??0)-line.cents);}
    }
  }
  const contributions=state.people.map(p=>({personId:p.id,paid:0,returned:0,net:0}));
  for(const transfer of state.transfers){
    const pair=[live.find(t=>t.id===transfer.fromId),live.find(t=>t.id===transfer.toId)];
    if(!pair[0]||!pair[1])continue;
    const debit=pair.find(t=>t!.cents<0)!;const credit=pair.find(t=>t!.cents>0)!;
    if(!inPeriod(credit))continue;
    const source=accountFor(state,debit.accountId);const destination=accountFor(state,credit.accountId);
    if(source.ownerIds.length===1 && destination.ownerIds.length>1){const c=contributions.find(p=>p.personId===source.ownerIds[0])!;c.paid+=credit.cents;}
    if(source.ownerIds.length>1 && destination.ownerIds.length===1){const c=contributions.find(p=>p.personId===destination.ownerIds[0])!;c.returned+=credit.cents;}
  }
  for(const c of contributions)c.net=c.paid-c.returned;
  return {income,expenses,net:income-expenses,reviewCount:live.filter(t=>!transfers.has(t.id)&&(!t.reviewed||t.allocations.some(a=>a.category==="À classer"))).length+state.transfers.filter(t=>!t.toId).length,categories:[...categories].map(([category,cents])=>({category,cents})),contributions,balances:state.accounts.map(account=>({accountId:account.id,movement:live.filter(t=>t.accountId===account.id&&inPeriod(t)).reduce((s,t)=>s+t.cents,0),balance:account.opening?account.opening.cents+live.filter(t=>t.accountId===account.id&&t.date>=account.opening!.date).reduce((s,t)=>s+t.cents,0):null}))};
}
export function exportHousehold(state: HouseholdState, mode: string, contextId?:string, accountId?:string, from?:string,to?:string) {
  const transfers=new Set(state.transfers.flatMap(t=>[t.fromId,t.toId]));
  const rows: (string|number|boolean)[][]=[mode==="allocations"?["Transaction","Date","Compte","Libellé","Contexte","Catégorie","Montant EUR","Nature","Virement","Vérifié"]:["Transaction","Date","Compte","Libellé","Montant EUR","Nature","Virement","Vérifié"]];
  for(const t of state.transactions.filter(t=>!t.deleted&&(!accountId||t.accountId===accountId)&&(!from||t.date>=from)&&(!to||t.date<=to))){
    if(mode==="allocations"){
      if(transfers.has(t.id))continue;
      for(const a of t.allocations){
        const c=state.contexts.find(c=>c.id===a.contextId)!;
        if(contextId&&contextId!=="all"&&contextId!==c.id&&contextId!==c.personId&&!(contextId==="household"&&c.kind!=="activity"))continue;
        rows.push([t.id,t.date,accountFor(state,t.accountId).name,t.label,c.name,a.category,(a.cents/100).toFixed(2),t.nature,transfers.has(t.id),t.reviewed]);
      }
    }else rows.push([t.id,t.date,accountFor(state,t.accountId).name,t.label,(t.cents/100).toFixed(2),t.nature,transfers.has(t.id),t.reviewed]);
  }
  return "\uFEFF"+rows.map(row=>row.map(value=>'"'+String(value).replace(/^[=+@\t\r]/,"'$&").replace(/"/g,'""')+'"').join(";")).join("\r\n");
}
