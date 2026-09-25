import {useLive} from "./liveStore";
import {scopedMovements} from "./LiveFinance";
import {openScope,scopeName,type ScopeTab} from "./model";
export function LiveTasks({spec}:{spec:ScopeTab}){
 const s=useLive(x=>x.data)!;const movements=scopedMovements(s,spec.scope),ids=new Set(movements.map(m=>m.id));
 const tasks:{id:string;label:string;target:ScopeTab}[]=[];
 for(const m of movements){const reasons=[m.sourceChange?"Correction bancaire":null,m.duplicateCandidates?.length?"Doublon possible":null,m.allocations.some(a=>a.target==="unassigned")?"Affectation à préciser":null,!m.reviewed?"Mouvement à vérifier":null].filter(Boolean);if(reasons.length)tasks.push({id:m.id,label:reasons.join(" · ")+" — "+m.label,target:{view:"movement",scope:m.accountId,record:m.id}});}
 for(const t of s.treatments)if(t.transaction.status==="pending"&&(spec.scope==="root"||t.companyId===spec.scope||t.movementId&&ids.has(t.movementId)))tasks.push({id:t.transaction.id,label:"Traitement à vérifier · "+scopeName(t.companyId)+" · "+t.transaction.label,target:{view:"accounting",scope:t.companyId,record:t.transaction.id}});
 for(const d of s.documents)if(!d.movementIds.length&&(spec.scope==="root"||d.links.includes(spec.scope)))tasks.push({id:d.id,label:"Pièce à relier · "+d.name,target:{view:"documents",scope:"root",record:d.id}});
 for(const t of s.transfers)if(!t.toId&&ids.has(t.fromId))tasks.push({id:t.id,label:"Virement : contrepartie à retrouver",target:{view:"placeholder",scope:spec.scope,toolId:"transfers",label:"Virements"}});
 return <div className="eco-work"><h1>À traiter · {scopeName(spec.scope)}</h1><p>Chaque action s’ouvre dans son contexte d’origine.</p>{tasks.map(t=><p key={t.id}><button onClick={()=>openScope(t.target)}>{t.label} ↗</button></p>)}{!tasks.length&&<p>Aucun élément à traiter.</p>}</div>;
}
