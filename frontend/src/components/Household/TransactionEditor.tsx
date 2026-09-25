import { useState } from "react";
import { api, apiUrl } from "../../api/client";
import type { HouseholdState, HouseholdTransaction, Allocation } from "../../types/household";
import { Modal, Field, amount, euros, errorMessage, splitPercent, type Command } from "./shared";

export function AllocationEditor({state,lines,onChange,total}:{state:HouseholdState;lines:Allocation[];onChange:(lines:Allocation[])=>void;total:number}) {
  const [percent,setPercent]=useState("");
  return <section><h2>Affectations</h2><p className="hh-muted">Le compte indique qui a payé. Les affectations indiquent à quoi sert la dépense.</p>
    {lines.map((line,index)=><div className="hh-alloc-row" key={index}>
      <select aria-label={"Contexte "+(index+1)} value={line.contextId} onChange={e=>onChange(lines.map((a,i)=>i===index?{...a,contextId:e.target.value}:a))}>{state.contexts.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <input aria-label={"Catégorie "+(index+1)} value={line.category} onChange={e=>onChange(lines.map((a,i)=>i===index?{...a,category:e.target.value}:a))}/>
      <input aria-label={"Montant affecté "+(index+1)} type="number" step=".01" value={line.cents/100} onChange={e=>onChange(lines.map((a,i)=>i===index?{...a,cents:amount(e.target.value)}:a))}/>
      <button type="button" aria-label={"Retirer affectation "+(index+1)} disabled={lines.length===1} onClick={()=>onChange(lines.filter((_,i)=>i!==index))}>×</button>
    </div>)}
    <div className="hh-row"><button type="button" onClick={()=>onChange([...lines,{contextId:state.contexts[0].id,category:lines[0]?.category??"À classer",cents:0}])}>+ Affectation</button><small>Reste à affecter : {euros(total-lines.reduce((s,a)=>s+a.cents,0))}</small></div>
    <details><summary>Répartir en pourcentages</summary><div className="hh-row"><Field label="Pourcentages, séparés par ; (ex. 60;25;15)"><input value={percent} onChange={e=>setPercent(e.target.value)}/></Field><button type="button" onClick={()=>{
      const values=percent.split(";").map(v=>Number(v.replace(",",".")));if(values.length!==lines.length||values.some(v=>!Number.isFinite(v)||v<0)||Math.abs(values.reduce((s,v)=>s+v,0)-100)>.0001)return;
      const parts=splitPercent(total,values);onChange(lines.map((a,i)=>({...a,cents:parts[i]})));
    }}>Appliquer</button></div><small>Un pourcentage par ligne, total 100 %. Le dernier montant absorbe l’arrondi.</small></details>
  </section>;
}
export function TransactionEditor({state,transaction,onClose,command,onRefresh}:{state:HouseholdState;transaction?:HouseholdTransaction;onClose:()=>void;command:Command;onRefresh:()=>Promise<void>}) {
  const [baseRevision,setBaseRevision]=useState(state.revision);
  const [baseTransaction,setBaseTransaction]=useState(transaction);
  const [accountId,setAccount]=useState(transaction?.accountId??state.accounts.find(a=>!a.archived)!.id);
  const [date,setDate]=useState(transaction?.date??new Date().toISOString().slice(0,10));
  const [label,setLabel]=useState(transaction?.label??"");
  const [value,setValue]=useState(String((transaction?.cents??0)/100));
  const [nature,setNature]=useState<HouseholdTransaction["nature"]>(transaction?.nature??"expense");
  const [notes,setNotes]=useState(transaction?.notes??"");
  const [reviewed,setReviewed]=useState(transaction?.reviewed??false);
  const [lines,setLines]=useState<Allocation[]>(transaction?.allocations??[{contextId:state.accounts.find(a=>a.id===accountId)!.defaultContextId,category:"À classer",cents:0}]);
  const [error,setError]=useState("");const [busy,setBusy]=useState(false);const [ocr,setOcr]=useState("");
  const imported=!!transaction?.source;
  return <Modal title={transaction?"Modifier le mouvement":"Nouveau mouvement"} onClose={onClose}><form onSubmit={async e=>{
    e.preventDefault();setBusy(true);setError("");try{await command({action:"transaction",id:transaction?.id,expectedRevision:baseTransaction?.revision,transaction:{accountId,date,label,cents:amount(value),nature,allocations:lines,notes,reviewed}},baseRevision);onClose();}
    catch(error){setError(errorMessage(error));}finally{setBusy(false);}
  }}>
    {imported&&<p className="hh-notice">Date, compte et montant bancaire sont conservés. Les affectations restent modifiables.</p>}
    <div className="hh-row"><Field label="Compte"><select disabled={imported} value={accountId} onChange={e=>setAccount(e.target.value)}>{state.accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></Field><Field label="Date"><input required type="date" disabled={imported} value={date} onChange={e=>setDate(e.target.value)}/></Field></div>
    <Field label="Libellé"><input required value={label} onChange={e=>setLabel(e.target.value)}/></Field>
    <div className="hh-row"><Field label="Montant EUR (dépense négative)"><input type="number" step=".01" required disabled={imported} value={value} onChange={e=>{setValue(e.target.value);if(lines.length===1)setLines([{...lines[0],cents:amount(e.target.value)}]);}}/></Field>
    <Field label="Nature"><select value={nature} onChange={e=>setNature(e.target.value as HouseholdTransaction["nature"])}><option value="expense">Dépense</option><option value="income">Revenu</option><option value="refund">Remboursement de dépense</option></select></Field></div>
    <AllocationEditor state={state} lines={lines} onChange={setLines} total={amount(value)}/>
    <Field label="Notes"><textarea value={notes} onChange={e=>setNotes(e.target.value)}/></Field>
    <label><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/> Affectations vérifiées</label>
    {transaction&&<section><h2>Justificatifs</h2><div className="hh-row">{baseTransaction?.attachments.map(a=><a key={a.id} className="hh-link" href={apiUrl("household/receipts/"+a.id)} target="_blank" rel="noreferrer">{a.name}</a>)}</div>
    {baseTransaction?.attachments.map(a=><button key={a.id} type="button" disabled={busy} onClick={async()=>{setBusy(true);try{const {data}=await api.post<{text:string}>("/household/receipts/"+a.id+"/analyze");setOcr(data.text);}catch(error){setError(errorMessage(error));}finally{setBusy(false);}}}>Lire le texte localement · {a.name}</button>)}
    {ocr&&<Field label="Texte OCR à vérifier"><textarea readOnly value={ocr}/></Field>}
    <Field label="Ajouter un justificatif"><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" disabled={busy} onChange={async e=>{
      const file=e.target.files?.[0];if(!file)return;setBusy(true);setError("");const form=new FormData();form.append("file",file);
      try{const {data}=await api.post<HouseholdState>("/household/transactions/"+transaction.id+"/receipts",form,{params:{revision:baseRevision,transactionRevision:baseTransaction?.revision}});setBaseRevision(data.revision);setBaseTransaction(data.transactions.find(t=>t.id===transaction.id));await onRefresh();}
      catch(error){setError(errorMessage(error));}finally{setBusy(false);e.target.value="";}
    }}/></Field></section>}
    {error&&<div role="alert" className="hh-error">{error}<button type="button" onClick={async()=>{await onRefresh();onClose();}}>Recharger et revoir le mouvement</button></div>}
    <footer><button type="button" onClick={onClose}>Annuler</button><button className="hh-primary" disabled={busy||lines.reduce((s,a)=>s+a.cents,0)!==amount(value)}>Enregistrer</button></footer>
  </form></Modal>;
}
