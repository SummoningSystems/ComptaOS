import {useState,useEffect} from "react";
import {useLive,liveRequest,errorText} from "./liveStore";
import {Dialog} from "./Structure";
import {scopedMovements} from "./LiveFinance";
import {documentMatch} from "./LiveDocuments";
import {openScope,scopeName,type ScopeTab} from "./model";
export function LiveSearch({scope,onClose}:{scope:string;onClose:()=>void}){
 const s=useLive(x=>x.data)!;const [query,setQuery]=useState(""),[local,setLocal]=useState(false);const q=query.trim().toLocaleLowerCase("fr");
 const hit=(value:string)=>!!q&&value.toLocaleLowerCase("fr").includes(q);const selected=local?scope:"root";
 const [files,setFiles]=useState<{scope:string;path:string;name:string;excerpt?:string}[]>([]),[error,setError]=useState("");
 useEffect(()=>{let active=true;setFiles([]);setError("");const timer=setTimeout(()=>{if(q)void liveRequest<typeof files>("get","search-files?"+new URLSearchParams({q,scope:selected})).then(rows=>{if(active)setFiles(rows);}).catch(e=>{if(active)setError(errorText(e));});},250);return()=>{active=false;clearTimeout(timer);};},[q,selected]);
 const rows:{id:string;label:string;spec:ScopeTab}[]=[
 ...files.map(f=>({id:"file:"+f.scope+":"+f.path,label:"Fichier · "+scopeName(f.scope)+" · "+f.name,spec:{view:"placeholder" as const,scope:f.scope,toolId:"editor" as const,businessType:"editor" as const,businessPath:f.path,label:f.name}})),
 ...s.entities.filter(e=>hit(e.name)&&(!local||e.id===scope)).map(e=>({id:e.id,label:e.name,spec:{view:"placeholder" as const,scope:e.id,toolId:"overview" as const,label:"Dashboard"}})),
 ...scopedMovements(s,selected).filter(m=>hit(m.label+" "+m.notes+" "+m.date+" "+m.allocations.map(a=>a.category).join(" "))).map(m=>({id:m.id,label:"Mouvement · "+m.date+" · "+m.label+" · "+scopeName(m.accountId),spec:{view:"movement" as const,scope:m.accountId,record:m.id}})),
 ...s.documents.filter(d=>documentMatch(s,d,selected)&&hit(d.name+" "+d.kind)).map(d=>({id:d.id,label:"Document · "+d.name,spec:{view:"documents" as const,scope:selected,record:d.id}})),
 ...s.treatments.filter(t=>(selected==="root"||t.companyId===selected)&&hit(t.transaction.label+" "+t.transaction.invoiceRef+" "+t.transaction.tags?.join(" "))).map(t=>({id:t.transaction.id,label:"Traitement · "+scopeName(t.companyId)+" · "+t.transaction.label,spec:{view:"accounting" as const,scope:t.companyId,record:t.transaction.id}}))
 ];
 return <Dialog title="Rechercher dans l’écosystème" onClose={onClose}><input aria-label="Rechercher" autoFocus value={query} onChange={e=>setQuery(e.target.value)}/><label><input type="checkbox" checked={local} onChange={e=>setLocal(e.target.checked)}/> Seulement {scopeName(scope)}</label>{rows.slice(0,100).map(r=><p key={r.id}><button onClick={()=>{openScope(r.spec);onClose();}}>{r.label}</button></p>)}{error&&<p role="alert">{error}</p>}{q&&!rows.length&&<p>Aucun résultat.</p>}{rows.length>100&&<p>100 premiers résultats. Précisez la recherche.</p>}</Dialog>;
}
