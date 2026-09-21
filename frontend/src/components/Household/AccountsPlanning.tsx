import { useState } from "react";
import type { HouseholdState, HouseholdAccount, HouseholdBudget, HouseholdRecurring } from "../../types/household";
import { Field, Modal, euros, amount, errorMessage, type Command } from "./shared";
import { AllocationEditor } from "./TransactionEditor";

export function AccountsPanel({state,command}:{state:HouseholdState;command:Command}) {
  const [editing,setEditing]=useState<HouseholdAccount|null>(null);
  const [revision,setRevision]=useState(0);const [error,setError]=useState("");const [busy,setBusy]=useState(false);
  return <section><div className="hh-row"><h1>Comptes du foyer</h1><button onClick={()=>{setError("");setRevision(state.revision);setEditing({id:"",name:"",ownerIds:[state.people[0].id],defaultContextId:state.contexts[0].id,currency:"EUR",purpose:"personal"});}}>+ Ajouter un compte</button></div><p>Les propriétaires servent à suivre les contributions. Les deux membres voient tous les comptes.</p>
  <div className="hh-grid">{state.accounts.map(account=><article className="hh-card" key={account.id}><h2>{account.name}</h2><p>{account.ownerIds.map(id=>state.people.find(p=>p.id===id)?.name).join(" & ")}</p><p className="hh-muted">{state.contexts.find(c=>c.id===account.defaultContextId)?.name}</p><p>{account.opening?"Solde initial : "+euros(account.opening.cents)+" au début du "+account.opening.date:"Solde initial non renseigné"}</p>{account.archived&&<p className="hh-tag">Archivé</p>}<button onClick={()=>{setError("");setRevision(state.revision);setEditing(structuredClone(account));}}>Modifier</button></article>)}</div>
  {editing&&<Modal title="Configurer le compte" onClose={()=>setEditing(null)}><form onSubmit={async e=>{e.preventDefault();setBusy(true);try{await command({action:"account",account:editing},revision);setEditing(null);}catch(error){setError(errorMessage(error));}finally{setBusy(false);}}}>
    <Field label="Nom du compte"><input required value={editing.name} onChange={e=>setEditing({...editing,name:e.target.value})}/></Field>
    <fieldset><legend>Propriétaires</legend>{state.people.map(p=><label key={p.id} style={{marginRight:20}}><input type="checkbox" checked={editing.ownerIds.includes(p.id)} onChange={e=>setEditing({...editing,ownerIds:e.target.checked?[...editing.ownerIds,p.id]:editing.ownerIds.filter(id=>id!==p.id)})}/> {p.name}</label>)}</fieldset>
    <div className="hh-row"><Field label="Affectation proposée"><select value={editing.defaultContextId} onChange={e=>setEditing({...editing,defaultContextId:e.target.value})}>{state.contexts.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><Field label="Usage"><select value={editing.purpose} onChange={e=>setEditing({...editing,purpose:e.target.value as HouseholdAccount["purpose"]})}><option value="personal">Personnel</option><option value="professional">Professionnel</option><option value="bills">Charges fixes</option><option value="daily">Quotidien</option></select></Field></div>
    <label><input type="checkbox" checked={!!editing.opening} onChange={e=>setEditing({...editing,opening:e.target.checked?{date:new Date().toISOString().slice(0,10),cents:0}:undefined})}/> Renseigner un solde initial</label>
    {editing.opening&&<><p className="hh-muted">Solde au début de la journée, avant les mouvements de cette date. Importez tous les mouvements à partir de cette date pour obtenir un solde calculé fiable.</p><div className="hh-row"><Field label="Date du solde initial"><input required type="date" value={editing.opening.date} onChange={e=>setEditing({...editing,opening:{...editing.opening!,date:e.target.value}})}/></Field><Field label="Solde initial EUR"><input required type="number" step=".01" value={editing.opening.cents/100} onChange={e=>setEditing({...editing,opening:{...editing.opening!,cents:amount(e.target.value)}})}/></Field></div></>}
    <p><label><input type="checkbox" checked={!!editing.archived} onChange={e=>setEditing({...editing,archived:e.target.checked})}/> Archiver ce compte (historique conservé)</label></p>
    {error&&<p role="alert" className="hh-error">{error}</p>}<footer><button type="button" onClick={()=>setEditing(null)}>Annuler</button><button className="hh-primary" disabled={busy}>Enregistrer</button></footer>
  </form></Modal>}
  </section>;
}

export function PlanningPanel({state,command}:{state:HouseholdState;command:Command}) {
  const [budget,setBudget]=useState<HouseholdBudget|null>(null);
  const [recurring,setRecurring]=useState<HouseholdRecurring|null>(null);
  const [revision,setRevision]=useState(state.revision);
  const [error,setError]=useState("");const [busy,setBusy]=useState(false);
  const month=new Date().toISOString().slice(0,7);
  const transfers=new Set(state.transfers.flatMap(t=>[t.fromId,t.toId]));
  return <section><h1>Budgets et échéances</h1><p className="hh-muted">Budgets mensuels par affectation. Les échéances sont des prévisions et ne créent aucun mouvement bancaire.</p>
  <div className="hh-row"><h2>Budgets · {month}</h2><button onClick={()=>{setError("");setRevision(state.revision);setBudget({id:"",contextId:state.contexts[0].id,category:"Courses",cents:0});}}>+ Budget</button></div>
  <div className="hh-grid">{state.budgets.map(b=>{
    const spent=-state.transactions.filter(t=>!t.deleted&&t.date.startsWith(month)&&t.nature!=="income"&&!transfers.has(t.id)).flatMap(t=>t.allocations).filter(a=>a.contextId===b.contextId&&a.category===b.category).reduce((s,a)=>s+a.cents,0);
    return <article className="hh-card" key={b.id}><h2>{b.category}</h2><small>{state.contexts.find(c=>c.id===b.contextId)?.name}</small><p>{euros(spent)} / {euros(b.cents)}</p><progress aria-label={b.category} max={Math.max(1,b.cents)} value={Math.max(0,spent)}/><button onClick={()=>{setError("");setRevision(state.revision);setBudget({...b});}}>Modifier</button></article>;
  })}</div>
  <div className="hh-row"><h2>Échéances récurrentes</h2><button onClick={()=>{setError("");setRevision(state.revision);setRecurring({id:"",label:"",accountId:state.accounts[0].id,cents:0,allocations:[{contextId:state.accounts[0].defaultContextId,category:"Abonnements",cents:0}],frequency:"monthly",nextDate:new Date().toISOString().slice(0,10),active:true});}}>+ Échéance</button></div>
  <div className="hh-grid">{state.recurring.map(r=><article className="hh-card" key={r.id}><h2>{r.label}</h2><p>{euros(r.cents)} · {{monthly:"Mensuel",quarterly:"Trimestriel",yearly:"Annuel"}[r.frequency]}</p><p>{r.active?"Prochaine échéance : "+r.nextDate:"Inactive"}</p><p className="hh-muted">{state.accounts.find(a=>a.id===r.accountId)?.name}</p><button onClick={()=>{setError("");setRevision(state.revision);setRecurring(structuredClone(r));}}>Modifier</button></article>)}</div>
  {(budget||recurring)&&<Modal title={budget?"Budget mensuel":"Échéance récurrente"} onClose={()=>{setBudget(null);setRecurring(null);}}><form onSubmit={async e=>{
    e.preventDefault();setBusy(true);try{await command(budget?{action:"budget",budget}:{action:"recurring",recurring},revision);setBudget(null);setRecurring(null);}catch(error){setError(errorMessage(error));}finally{setBusy(false);}
  }}>
    {budget&&<><Field label="Contexte"><select value={budget.contextId} onChange={e=>setBudget({...budget,contextId:e.target.value})}>{state.contexts.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><Field label="Catégorie"><input required value={budget.category} onChange={e=>setBudget({...budget,category:e.target.value})}/></Field><Field label="Budget mensuel EUR"><input type="number" min="0" step=".01" required value={budget.cents/100} onChange={e=>setBudget({...budget,cents:amount(e.target.value)})}/></Field></>}
    {recurring&&<><Field label="Libellé"><input required value={recurring.label} onChange={e=>setRecurring({...recurring,label:e.target.value})}/></Field><div className="hh-row"><Field label="Compte"><select value={recurring.accountId} onChange={e=>setRecurring({...recurring,accountId:e.target.value})}>{state.accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></Field><Field label="Montant EUR"><input type="number" min=".01" step=".01" required value={recurring.cents/100} onChange={e=>{const cents=amount(e.target.value);setRecurring({...recurring,cents,allocations:recurring.allocations.length===1?[{...recurring.allocations[0],cents:-cents}]:recurring.allocations});}}/></Field></div>
    <div className="hh-row"><Field label="Fréquence"><select value={recurring.frequency} onChange={e=>setRecurring({...recurring,frequency:e.target.value as HouseholdRecurring["frequency"]})}><option value="monthly">Mensuelle</option><option value="quarterly">Trimestrielle</option><option value="yearly">Annuelle</option></select></Field><Field label="Prochaine date"><input type="date" required value={recurring.nextDate} onChange={e=>setRecurring({...recurring,nextDate:e.target.value})}/></Field></div>
    <AllocationEditor state={state} lines={recurring.allocations} total={-recurring.cents} onChange={allocations=>setRecurring({...recurring,allocations})}/>
    <label><input type="checkbox" checked={recurring.active} onChange={e=>setRecurring({...recurring,active:e.target.checked})}/> Échéance active</label></>}
    {error&&<p role="alert" className="hh-error">{error}</p>}<footer><button className="hh-primary" disabled={busy}>Enregistrer</button></footer>
  </form></Modal>}
  </section>;
}
