import {currentEcosystemCompany,loadEcosystem,mutateEcosystem,uid} from "./ecosystemService.js";
import {loadManualRecurring,type ManualRecurring} from "./manualRecurringService.js";
import {loadBudgets,type CategoryBudget} from "./settingsService.js";
import type {Ecosystem,Recurring} from "../types/ecosystem.js";
import {fail} from "./householdService.js";
export function recurringForCompany(s:Ecosystem,companyId:string):ManualRecurring[]{
 return s.recurring.filter(r=>r.allocations.some(a=>a.target===companyId)).map(r=>({id:r.id,label:r.label,category:r.allocations.find(a=>a.target===companyId)!.category,amount:-r.allocations.filter(a=>a.target===companyId).reduce((n,a)=>n+a.cents,0)/100,frequency:r.frequency==="monthly"?"mensuel":r.frequency==="quarterly"?"trimestriel":"annuel",nextPayment:r.nextDate,endPayment:r.endDate,active:r.active,decision:r.decision,simulatedAmount:r.simulatedCents===undefined?undefined:r.simulatedCents/100,notes:r.notes}));
}
export async function planningContext(){
 const company=currentEcosystemCompany();if(!company)return null;
 const state=await loadEcosystem(company.ecosystemId!),entity=state.entities.find(e=>e.workspaceId===company.id)!;
 return {state,entity};
}
export async function readRecurring(){const c=await planningContext();if(!c)return loadManualRecurring();return [...recurringForCompany(c.state,c.entity.id),...(c.state.planningMigrated?.includes("recurring:"+c.entity.id)?[]:loadManualRecurring())];}
export async function writeRecurring(entries:ManualRecurring[],revision?:number){
 const c=await planningContext();if(!c)return false;
 await mutateEcosystem(c.state.id,revision??c.state.revision,"recurring-company",s=>{
  const existing=s.recurring.filter(r=>r.allocations.some(a=>a.target===c.entity.id));
  const mixed=existing.filter(r=>r.allocations.some(a=>a.target!==c.entity.id));
  for(const r of mixed){const submitted=entries.find(v=>v.id===r.id),original=recurringForCompany(s,c.entity.id).find(v=>v.id===r.id);if(JSON.stringify(submitted)!==JSON.stringify(original))fail("Modifiez l’échéance partagée depuis la vue d’ensemble.",409);}
  s.recurring=s.recurring.filter(r=>!existing.includes(r)||mixed.includes(r));
  for(const v of entries.filter(v=>!mixed.some(r=>r.id===v.id))){
   if(s.recurring.some(r=>r.id===v.id))fail("Identifiant d’échéance déjà utilisé.",409);
   const old=existing.find(r=>r.id===v.id),cents=Math.round(v.amount*100);
   const row:Recurring={id:v.id,label:v.label,accountId:old?.accountId??"",cents,allocations:[{id:old?.allocations[0]?.id??uid(),target:c.entity.id,category:v.category,cents:-cents}],frequency:v.frequency==="mensuel"?"monthly":v.frequency==="trimestriel"?"quarterly":"yearly",nextDate:v.nextPayment,endDate:v.endPayment,active:v.active,decision:v.decision,simulatedCents:v.simulatedAmount===undefined?undefined:Math.round(v.simulatedAmount*100),notes:v.notes,originCompany:c.entity.id};s.recurring.push(row);
  }
  s.planningMigrated=[...new Set([...(s.planningMigrated??[]),"recurring:"+c.entity.id])];return {companyId:c.entity.id,count:entries.length};
 });return true;
}
export async function readBudgets(){const c=await planningContext();if(!c)return loadBudgets();const rows=c.state.budgets.filter(b=>b.target===c.entity.id).map(b=>({category:b.category,monthlyLimit:b.cents/100}));return [...rows,...(c.state.planningMigrated?.includes("budgets:"+c.entity.id)?[]:loadBudgets().filter(b=>!rows.some(r=>r.category===b.category)))];}
export async function writeBudgets(entries:CategoryBudget[],revision?:number){
 const c=await planningContext();if(!c)return false;
 if(!Array.isArray(entries)||entries.some(b=>!b.category||!Number.isFinite(b.monthlyLimit)||b.monthlyLimit<0)||new Set(entries.map(b=>b.category)).size!==entries.length)fail("Budgets invalides.");
 await mutateEcosystem(c.state.id,revision??c.state.revision,"budgets-company",s=>{
  const old=s.budgets.filter(b=>b.target===c.entity.id);s.budgets=s.budgets.filter(b=>b.target!==c.entity.id);
  s.budgets.push(...entries.map(b=>({id:old.find(o=>o.category===b.category)?.id??uid(),target:c.entity.id,category:b.category,cents:Math.round(b.monthlyLimit*100),basis:"accounting" as const})));
  s.planningMigrated=[...new Set([...(s.planningMigrated??[]),"budgets:"+c.entity.id])];return {companyId:c.entity.id};
 });return true;
}
