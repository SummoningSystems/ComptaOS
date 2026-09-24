import {useEffect,useState,useMemo} from "react";
import {useLive,errorText} from "./liveStore";
import {createWorkspaceApi} from "../../api/client";
import {openScope,scopeName,type ScopeTab} from "./model";
import type {TabType} from "../../types";
export function LiveBusinessIndex({spec,type}:{spec:ScopeTab;type:TabType}){
 const s=useLive(x=>x.data)!;const companies=useMemo(()=>s.entities.filter(e=>e.kind==="company"&&e.workspaceId&&(spec.scope==="root"||s.relations.some(r=>r.kind==="activity"&&r.from===spec.scope&&r.to===e.id))),[s.entities,s.relations,spec.scope]);
 const [rows,setRows]=useState<{company:string;id:string;label:string}[]>([]),[error,setError]=useState("");

 useEffect(()=>{let active=true;setRows([]);setError("");void Promise.all(companies.map(async c=>{
  const api=createWorkspaceApi(c.workspaceId!);
  if(type==="tiers"){const txns=await api.fetchTransactions();return [...new Set(txns.map(t=>t.notes?.trim()||"(sans tiers)"))].map(name=>({company:c.id,id:name,label:name+" · "+txns.filter(t=>(t.notes?.trim()||"(sans tiers)")===name).length+" écritures"}));}
  if(type==="templates"){const {data}=await api.api.get<{id:string;name:string;label:string}[]>("templates");return data.map(t=>({company:c.id,id:t.id,label:t.name+" · "+t.label}));}
  if(type==="hr"){const employees=await api.fetchHrEmployees();return employees.map(e=>({company:c.id,id:e.id,label:e.firstName+" "+e.lastName}));}
  const items=type==="invoices"?await api.fetchInvoices():type==="quotes"?await api.fetchQuotes():[];
  return items.map(v=>({company:c.id,id:v.id,label:v.number+" · "+v.client+" · "+v.amount_ttc.toFixed(2)+" EUR · "+v.status}));
 })).then(groups=>{if(active)setRows(groups.flat());}).catch(e=>{if(active)setError(errorText(e));});return()=>{active=false;};},[companies,type]);
 return <div className="eco-work"><h1>{spec.label??"Outils par entreprise"} · {scopeName(spec.scope)}</h1><p>Consultez les éléments associés. La création et les modifications s’ouvrent dans l’onglet de l’entreprise concernée.</p>{companies.map(c=><section key={c.id}><h2>{c.name}</h2><button onClick={()=>openScope({...spec,scope:c.id,businessType:type})}>Ouvrir {spec.label??"l’outil"} · {c.name}</button>{rows.filter(r=>r.company===c.id).map(r=><p key={r.id}><button onClick={()=>openScope({...spec,scope:c.id,businessType:type})}>{r.label}</button></p>)}</section>)}{!companies.length&&<p>Aucune entreprise associée à ce périmètre.</p>}{error&&<p role="alert">{error}</p>}</div>;
}
