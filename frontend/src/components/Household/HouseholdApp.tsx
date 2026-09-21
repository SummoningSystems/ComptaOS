import { useCallback, useEffect, useState } from "react";
import { api, apiUrl, fetchCompanies, setActiveCompanyApi } from "../../api/client";
import { createInvitation, type AuthUser } from "../../api/auth";
import type { Company } from "../../types";
import type { HouseholdState, HouseholdSummary, HouseholdTransaction } from "../../types/household";
import { TransactionEditor } from "./TransactionEditor";
import { ImportPanel } from "./ImportPanel";
import { AccountsPanel, PlanningPanel } from "./AccountsPlanning";
import { Field, load, euros, errorMessage, type Command } from "./shared";
import "./household.css";
type Page = "overview"|"transactions"|"review"|"import"|"accounts"|"planning"|"transfers"|"history"|"members";
const pages: {id:Page;label:string}[]=[{id:"overview",label:"Vue d’ensemble"},{id:"transactions",label:"Mouvements"},{id:"review",label:"À vérifier"},{id:"import",label:"Importer"},{id:"accounts",label:"Comptes"},{id:"planning",label:"Budgets & échéances"},{id:"transfers",label:"Virements"},{id:"history",label:"Historique"},{id:"members",label:"Membres"}];

export function HouseholdApp({workspace,user,onLogout,onCreate}:{workspace:Company;user:AuthUser|null;onLogout:()=>Promise<void>;onCreate:()=>void}) {
  const key="household_view_"+(user?.id??"local")+"_"+workspace.id;
  const saved=()=>{try{return JSON.parse(localStorage.getItem(key)??"{}") as {context?:string;account?:string};}catch{return {};}};
  const [state,setState]=useState<HouseholdState|null>(null);
  const [workspaces,setWorkspaces]=useState<Company[]>([]);
  const [page,setPage]=useState<Page>("overview");
  const [context,setContext]=useState(saved().context??"all");
  const [account,setAccount]=useState(saved().account??"");
  const [from,setFrom]=useState(new Date().toISOString().slice(0,7)+"-01");
  const [to,setTo]=useState("");
  const [search,setSearch]=useState("");
  const [summary,setSummary]=useState<HouseholdSummary|null>(null);
  const [editing,setEditing]=useState<HouseholdTransaction|null|undefined>(undefined);
  const [selected,setSelected]=useState<string[]>([]);
  const [bulkContext,setBulkContext]=useState("");
  const [error,setError]=useState("");const [busy,setBusy]=useState(false);
  const [invite,setInvite]=useState("");
  const [members,setMembers]=useState<{id:string;displayName:string;role:string;member:boolean}[]>([]);
  const [suggestions,setSuggestions]=useState<{fromId:string;toId:string}[]>([]);
  const [fromId,setFromId]=useState("");const [toId,setToId]=useState("");
  const [backup,setBackup]=useState<{enabled:boolean;lastSuccess?:string;error?:string}|null>(null);
  const readonly=user?.role==="readonly";
  const admin=!user||["owner","admin"].includes(user.role);
  const refresh=useCallback(async()=>{const data=await load();setState(data);},[]);
  useEffect(()=>{
    let active=true;
    const update=()=>{if(!document.hidden)load().then(data=>{if(active)setState(data);}).catch(error=>{if(active)setError(errorMessage(error));});};
    update();api.get<typeof members>("/household/members").then(({data})=>{if(active)setMembers(data);}).catch(error=>{if(active)setError(errorMessage(error));});fetchCompanies().then(data=>{if(active)setWorkspaces(data);}).catch(error=>setError(errorMessage(error)));
    window.addEventListener("focus",update);const timer=window.setInterval(update,15000);
    return()=>{active=false;clearInterval(timer);window.removeEventListener("focus",update);};
  },[]);
  useEffect(()=>{
    if(!state)return;let active=true;
    api.get<HouseholdSummary>("/household/summary",{params:{contextId:context,accountId:account||undefined,from:from||undefined,to:to||undefined}}).then(({data})=>{if(active)setSummary(data);}).catch(error=>{if(active)setError(errorMessage(error));});
    return()=>{active=false;};
  },[state,context,account,from,to]);
  useEffect(()=>{localStorage.setItem(key,JSON.stringify({context,account}));},[context,account,key]);
  useEffect(()=>{
    if(page==="transfers")api.get<{fromId:string;toId:string}[]>("/household/transfer-suggestions").then(({data})=>setSuggestions(data)).catch(error=>setError(errorMessage(error)));
    if(page==="members"){
      api.get<typeof members>("/household/members").then(({data})=>setMembers(data)).catch(error=>setError(errorMessage(error)));
      if(admin)api.get("/backups").then(({data})=>setBackup(data)).catch(error=>setError(errorMessage(error)));
    }
  },[page,state?.revision,admin]);
  const command:Command=async(values,revision)=>{
    if(!state)return;setBusy(true);setError("");
    try{const {data}=await api.post<HouseholdState>("/household/commands",{...values,revision:revision??state.revision});setState(data);}
    finally{setBusy(false);}
  };
  async function run(values:Record<string,unknown>) {try{await command(values);}catch(error){setError(errorMessage(error));}}
  if(!state)return <main className="hh hh-content"><h1>{workspace.name}</h1><p>{error||"Chargement du foyer…"}</p><button onClick={()=>void refresh().catch(error=>setError(errorMessage(error)))}>Réessayer</button></main>;
  const live=state.transactions.filter(t=>!t.deleted);
  const transfers=new Set(state.transfers.flatMap(t=>[t.fromId,t.toId]));
  const unmatched=new Set(state.transfers.filter(t=>!t.toId).map(t=>t.fromId));
  const contextMatch=(id:string)=>context==="all"||context===id||state.contexts.some(c=>c.id===id&&(c.personId===context||context==="household"&&c.kind!=="activity"));
  const transactions=live.filter(t=>(!account||t.accountId===account)&&(!from||t.date>=from)&&(!to||t.date<=to)&&t.allocations.some(a=>contextMatch(a.contextId))&&(!search||(t.label+" "+t.notes+" "+t.allocations.map(a=>a.category).join(" ")).toLowerCase().includes(search.toLowerCase()))&&(page!=="review"||unmatched.has(t.id)||!transfers.has(t.id)&&(!t.reviewed||t.allocations.some(a=>a.category==="À classer")))).sort((a,b)=>b.date.localeCompare(a.date));
  const accountName=(id:string)=>state.accounts.find(a=>a.id===id)?.name??id;
  const transactionName=(id?:string)=>{const t=live.find(t=>t.id===id);return t?t.date+" · "+t.label+" · "+euros(t.cents)+" · "+accountName(t.accountId):"Contrepartie à rapprocher";};
  const exportLink=(mode:string)=>apiUrl("household/export")+"?"+new URLSearchParams({mode,contextId:context,accountId:account,from,to}).toString();
  return <main className="hh"><header className="hh-top"><strong>ComptaOS</strong><a href="?prototype=ecosystem">Prototype écosystème</a><select aria-label="Espace actif" value={workspace.id} onChange={async e=>{try{await setActiveCompanyApi(e.target.value);location.reload();}catch(error){setError(errorMessage(error));}}}>{workspaces.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select>{admin&&<button onClick={onCreate}>+ Foyer</button>}<span className="hh-spacer"/><span>{user?.displayName??"Session locale"}</span><button onClick={()=>void onLogout()}>Déconnexion</button></header>
    <nav aria-label="Navigation du foyer">{pages.map(p=><button key={p.id} aria-current={page===p.id} onClick={()=>{setPage(p.id);setSelected([]);}}>{p.label}{p.id==="review"&&summary?.reviewCount?" ("+summary.reviewCount+")":""}</button>)}</nav>
    <div className="hh-content">
      {error&&<div role="alert" className="hh-error">{error} <button onClick={()=>{setError("");void refresh().catch(error=>setError(errorMessage(error)));}}>Recharger</button></div>}
      {["overview","transactions","review"].includes(page)&&<>
        <div className="hh-row"><div><p className="hh-eyebrow">FINANCES DU FOYER</p><h1>{page==="overview"?"Votre argent, une vue commune":page==="review"?"Mouvements à vérifier":"Mouvements bancaires"}</h1></div>{!readonly&&<button className="hh-primary" onClick={()=>setEditing(null)}>+ Mouvement</button>}</div>
        <div className="hh-row"><Field label="Vue"><select value={context} onChange={e=>setContext(e.target.value)}><option value="all">Tout</option><option value="household">Foyer · personnel et commun</option>{state.people.map(p=><option value={p.id} key={p.id}>{p.name} · ensemble</option>)}{state.contexts.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Compte source"><select value={account} onChange={e=>setAccount(e.target.value)}><option value="">Tous les comptes</option>{state.accounts.map(a=><option value={a.id} key={a.id}>{a.name}</option>)}</select></Field><Field label="Du"><input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></Field><Field label="Au"><input type="date" value={to} onChange={e=>setTo(e.target.value)}/></Field></div>
        {summary&&<div className="hh-grid">{[["Revenus encaissés",summary.income],["Dépenses nettes",summary.expenses],["Solde de la période",summary.net]].map(([label,value])=><article className="hh-card" key={String(label)}><small>{label}</small><span className="hh-number">{euros(Number(value))}</span></article>)}</div>}
        {page==="overview"&&summary&&summary.categories.length>0&&<div className="hh-card"><h2>Dépenses par catégorie</h2>{summary.categories.sort((a,b)=>b.cents-a.cents).map(category=><div className="hh-row" key={category.category}><span>{category.category}</span><progress aria-label={category.category} max={Math.max(1,...summary.categories.map(c=>c.cents))} value={Math.max(0,category.cents)}/><span className="hh-amount">{euros(category.cents)}</span></div>)}</div>}
        <p className="hh-muted">Montants payés, sans estimation de TVA. Les virements internes sont exclus des revenus et dépenses. Les affectations non vérifiées restent incluses à titre provisoire.</p>
        <div className="hh-row"><Field label="Rechercher"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Libellé, catégorie ou note"/></Field><a className="hh-button" href={exportLink("transactions")}>CSV bancaire</a><a className="hh-button" href={exportLink("allocations")}>CSV des affectations</a></div>
        <small>Le CSV bancaire suit les comptes et dates ; le CSV des affectations applique aussi la vue sélectionnée et exclut les virements internes.</small>
        {!!selected.length&&!readonly&&<div className="hh-row"><span>{selected.length} sélectionnés</span><select aria-label="Affectation en lot" value={bulkContext} onChange={e=>setBulkContext(e.target.value)}><option value="">Choisir une affectation</option>{state.contexts.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><button disabled={!bulkContext||busy} onClick={()=>void run({action:"bulk",changes:live.filter(t=>selected.includes(t.id)).map(t=>({id:t.id,revision:t.revision,patch:{allocations:[{contextId:bulkContext,category:t.allocations[0].category,cents:t.cents}],reviewed:false}}))})}>Affecter à 100 %</button><button disabled={busy} onClick={()=>void run({action:"bulk",changes:live.filter(t=>selected.includes(t.id)).map(t=>({id:t.id,revision:t.revision,patch:{reviewed:true}}))})}>Marquer vérifiés</button></div>}
        <div className="hh-table-wrap"><table><thead><tr><th>Sélection</th><th>Date / Compte</th><th>Libellé</th><th>Affectations</th><th className="hh-amount">Montant bancaire</th><th>Actions</th></tr></thead><tbody>{transactions.map(t=><tr key={t.id}><td><input aria-label={"Sélectionner "+t.label} type="checkbox" disabled={readonly} checked={selected.includes(t.id)} onChange={e=>setSelected(e.target.checked?[...selected,t.id]:selected.filter(id=>id!==t.id))}/></td><td>{t.date}<br/><small>{accountName(t.accountId)}</small></td><td>{t.label}<br/>{transfers.has(t.id)?<span className="hh-tag">Virement interne</span>:<small>{t.reviewed?"Vérifié":"À vérifier"}</small>}{t.attachments.length>0&&<small> · {t.attachments.length} justificatif(s)</small>}</td><td>{t.allocations.map((a,i)=><div key={i}><small>{state.contexts.find(c=>c.id===a.contextId)?.name}</small><br/>{a.category} · {euros(a.cents)}</div>)}</td><td className="hh-amount">{euros(t.cents)}</td><td>{!readonly?<><button onClick={()=>setEditing(t)}>Modifier</button> <button disabled={busy} onClick={()=>{if(window.confirm("Supprimer ce mouvement ? Son historique sera conservé."))void run({action:"delete",id:t.id,expectedRevision:t.revision});}}>Supprimer</button></>:t.attachments.map(a=><a className="hh-link" key={a.id} href={apiUrl("household/receipts/"+a.id)} target="_blank" rel="noreferrer">{a.name}</a>)}</td></tr>)}</tbody></table>{!transactions.length&&<p className="hh-empty">Aucun mouvement pour ces filtres. Importez un relevé pour commencer.</p>}</div>
        {page==="overview"&&summary&&<><h2 style={{marginTop:24}}>Comptes et contributions</h2><div className="hh-grid">{summary.balances.filter(b=>!account||b.accountId===account).map(b=><article key={b.accountId} className="hh-card"><h2>{accountName(b.accountId)}</h2><span className="hh-number">{b.balance===null?"Solde inconnu":euros(b.balance)}</span><p className="hh-muted">{b.balance===null?"Ajoutez un solde initial dans Comptes.":"Solde calculé sur tous les mouvements importés depuis le solde initial."}</p><p>Mouvement de la période : {euros(b.movement)}</p></article>)}</div><div className="hh-grid">{summary.contributions.map(c=><article className="hh-card" key={c.personId}><h2>{state.people.find(p=>p.id===c.personId)?.name}</h2><p>Versés au commun : {euros(c.paid)}</p><p>Retours : {euros(c.returned)}</p><strong>Contribution nette : {euros(c.net)}</strong></article>)}</div><small>Contributions calculées sur les virements confirmés de la période, pour tous les comptes du foyer.</small></>}
      </>}
      {page==="import"&&(readonly?<p>Import réservé aux membres pouvant modifier.</p>:<ImportPanel state={state} onRefresh={refresh}/>)}
      {page==="accounts"&&(readonly?<p>Modification des comptes réservée aux membres pouvant modifier.</p>:<AccountsPanel state={state} command={command}/>)}
      {page==="planning"&&(readonly?<p>Modification des budgets réservée aux membres pouvant modifier.</p>:<PlanningPanel state={state} command={command}/>)}
      {page==="transfers"&&<section><h1>Virements internes</h1><p>Confirmez les deux mouvements d’un virement pour éviter de compter un revenu ou une dépense.</p>{!readonly&&<><div className="hh-row"><Field label="Premier mouvement"><select value={fromId} onChange={e=>setFromId(e.target.value)}><option value="">Choisir</option>{live.filter(t=>!transfers.has(t.id)).map(t=><option key={t.id} value={t.id}>{transactionName(t.id)}</option>)}</select></Field><Field label="Contrepartie"><select value={toId} onChange={e=>setToId(e.target.value)}><option value="">À retrouver plus tard</option>{live.filter(t=>!transfers.has(t.id)&&t.id!==fromId).map(t=><option key={t.id} value={t.id}>{transactionName(t.id)}</option>)}</select></Field><button disabled={!fromId||busy} onClick={()=>void run({action:"transfer",fromId,toId:toId||undefined})}>Confirmer le virement</button></div><h2>Rapprochements suggérés</h2>{suggestions.map(s=><article className="hh-card" key={s.fromId+s.toId}><p>{transactionName(s.fromId)}</p><p>{transactionName(s.toId)}</p><button disabled={busy} onClick={()=>void run({action:"transfer",...s})}>Confirmer cette paire</button></article>)}</>}
      <h2 style={{marginTop:20}}>Virements enregistrés</h2>{state.transfers.map(t=><article key={t.id} className="hh-card"><p>{transactionName(t.fromId)}</p><p>{transactionName(t.toId)}</p>{!readonly&&<button disabled={busy} onClick={()=>void run({action:"unlink",id:t.id})}>Dissocier</button>}</article>)}</section>}
      {page==="history"&&<section><h1>Historique partagé</h1><p>Chaque modification conserve son auteur et sa date. Les mouvements supprimés restent dans l’historique.</p>{[...state.history].reverse().map((change,index)=><details key={index}><summary>{new Date(change.at).toLocaleString("fr-FR")} · {members.find(m=>m.id===change.actor)?.displayName??(change.actor===user?.id?user.displayName:"Session locale")} · {({transaction:"Mouvement",import:"Import",receipt:"Justificatif",transfer:"Virement",unlink:"Virement dissocié",delete:"Suppression",bulk:"Modification groupée",account:"Compte",budget:"Budget",recurring:"Échéance"} as Record<string,string>)[change.action]??change.action}</summary><pre>{JSON.stringify(change,null,2)}</pre></details>)}</section>}
      {page==="members"&&<section><h1>Membres du foyer</h1><p>Chaque membre de cet espace voit tous ses comptes et mouvements.</p>{members.filter(m=>m.member).map(m=><p key={m.id}>{m.displayName} · {m.role}</p>)}
      {admin&&<><button onClick={async()=>{try{const invitation=await createInvitation("admin",undefined,workspace.id);const url=new URL(location.origin+import.meta.env.BASE_URL);url.searchParams.set("invite",invitation.token);setInvite(url.toString());}catch(error){setError(errorMessage(error));}}}>Créer une invitation administrateur</button>{invite&&<Field label="Lien à transmettre à votre partenaire"><input readOnly value={invite} onFocus={e=>e.target.select()}/></Field>}
      {members.filter(m=>!m.member).map(m=><p key={m.id}>{m.displayName} <button onClick={async()=>{try{await api.post("/household/members",{userId:m.id});const {data}=await api.get<typeof members>("/household/members");setMembers(data);}catch(error){setError(errorMessage(error));}}}>Ajouter au foyer</button></p>)}
      <h2 style={{marginTop:25}}>Sauvegardes du serveur</h2><p>{backup?.enabled?"Sauvegardes quotidiennes activées.":"Configurer BACKUP_PATH sur le serveur pour activer les sauvegardes."}</p>{backup?.lastSuccess&&<p>Dernière sauvegarde : {new Date(backup.lastSuccess).toLocaleString("fr-FR")}</p>}{backup?.error&&<p className="hh-error">{backup.error}</p>}<button disabled={!backup?.enabled||busy} onClick={async()=>{setBusy(true);try{const {data}=await api.post("/backups");setBackup(data);}catch(error){setError(errorMessage(error));}finally{setBusy(false);}}}>Sauvegarder maintenant</button></>}
      </section>}
    </div>{editing!==undefined&&<TransactionEditor key={editing?.id??"new"} state={state} transaction={editing??undefined} onClose={()=>setEditing(undefined)} command={command} onRefresh={refresh}/>}
  </main>;
}
