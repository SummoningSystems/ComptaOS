import {useState} from "react";
import {useLive} from "./liveStore";
import {money,scopeName,type ScopeTab} from "./model";
import {accountBalance,treasuryAccounts} from "../../../../backend/src/domain/ecosystemMetrics";
import {addCalendarMonths} from "../Recurring/recurringModel";
export function LiveForecast({spec}:{spec:ScopeTab}){
 const s=useLive(x=>x.data)!;const [horizon,setHorizon]=useState(6);const today=new Date().toISOString().slice(0,10);
 const accounts=treasuryAccounts(s,spec.scope,today),balances=accounts.map(a=>accountBalance(s,a.id,today)),known=accounts.length>0&&balances.every(b=>b!==null);
 let baseline=known?balances.reduce<number>((n,b)=>n+b!,0):0,scenario=baseline;
 const rows=Array.from({length:horizon},(_,i)=>{const month=addCalendarMonths(today.slice(0,7)+"-01",i).slice(0,7);let baseExpense=0,scenarioExpense=0;const details:string[]=[];
 for(const r of s.recurring.filter(r=>r.active)){
 const fraction=spec.scope==="root"||r.accountId===spec.scope?1:-r.allocations.filter(a=>a.target===spec.scope).reduce((n,a)=>n+a.cents,0)/r.cents;
 if(!fraction)continue;let date=r.nextDate;let guard=0;
 while(date.slice(0,7)<=month&&(!r.endDate||date<=r.endDate)&&guard++<1200){
  if(date>=today&&date.startsWith(month)){
   const base=r.decision==="planned"?0:r.cents*fraction,sim=r.decision==="cancel"?0:(r.decision==="reduce"?r.simulatedCents??r.cents:r.cents)*fraction;
   baseExpense+=Math.round(base);scenarioExpense+=Math.round(sim);details.push(date+" · "+r.label+" · "+(r.accountId?scopeName(r.accountId):"Compte à préciser"));
  }date=addCalendarMonths(date,r.frequency==="monthly"?1:r.frequency==="quarterly"?3:12);
 }
 }
 baseline-=baseExpense;scenario-=scenarioExpense;return {month,baseExpense,scenarioExpense,baseline,scenario,details};});
 return <section><h2>Prévisions d’échéances</h2><p>Les prévisions n’ajoutent aucun mouvement réel. Les recettes futures ne sont pas supposées.</p><label>Horizon<select value={horizon} onChange={e=>setHorizon(Number(e.target.value))}>{[3,6,12].map(n=><option key={n} value={n}>{n} mois</option>)}</select></label><p>Comptes de trésorerie : {accounts.map(a=>scopeName(a.id)).join(", ")||"aucun compte dédié"}. {!known&&"Solde inconnu : seules les dépenses prévues sont présentées."}</p><table><thead><tr><th>Mois</th><th>Échéances de référence</th><th>Échéances simulées</th><th>Solde de référence</th><th>Solde simulé</th></tr></thead><tbody>{rows.map(r=><tr key={r.month}><td><details><summary>{r.month}</summary>{r.details.map((d,i)=><p key={i}>{d}</p>)}</details></td><td>{money(r.baseExpense)}</td><td>{money(r.scenarioExpense)}</td><td>{known?money(r.baseline):"Inconnu"}</td><td>{known?money(r.scenario):"Inconnu"}</td></tr>)}</tbody></table></section>;
}
