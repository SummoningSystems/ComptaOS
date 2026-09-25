import { useState } from "react";
import * as XLSX from "xlsx";
import { api } from "../../api/client";
import type { HouseholdState, HouseholdImport, ImportRow } from "../../types/household";
import { Field, euros, errorMessage } from "./shared";
export function ImportPanel({state,onRefresh}:{state:HouseholdState;onRefresh:()=>Promise<void>}) {
  const [accountId,setAccount]=useState(state.accounts.find(a=>!a.archived)?.id??"");
  const [format,setFormat]=useState<HouseholdImport["format"]>("csv");
  const [content,setContent]=useState("");const [columns,setColumns]=useState<string[]>([]);
  const [mapping,setMapping]=useState({date:"",label:"",amount:"",debit:"",credit:"",externalId:""});
  const [preview,setPreview]=useState<{rows:ImportRow[];invalid:number}|null>(null);
  const [selected,setSelected]=useState<number[]>([]);const [revision,setRevision]=useState(state.revision);
  const [error,setError]=useState("");const [notice,setNotice]=useState("");const [busy,setBusy]=useState(false);
  const invalidate=()=>{setPreview(null);setNotice("");};
  return <section><h1>Importer un relevé</h1><p className="hh-muted">Choisissez le compte avant l’import. Les doublons possibles restent à votre appréciation.</p>
    <div className="hh-row"><Field label="Compte destinataire"><select value={accountId} onChange={e=>{setAccount(e.target.value);invalidate();}}>{state.accounts.filter(a=>!a.archived).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
    <Field label="Format"><select value={format} onChange={e=>{setFormat(e.target.value as HouseholdImport["format"]);invalidate();}}><option value="csv">CSV</option><option value="ofx">OFX</option><option value="qif">QIF</option></select></Field>
    <Field label="Relevé bancaire"><input type="file" accept=".csv,.ofx,.qif,.ofc" onChange={async e=>{
      const file=e.target.files?.[0];if(!file)return;if(file.size>10_000_000){setError("Fichier trop volumineux (10 Mo maximum).");return;}
      const source=await file.text();setContent(source);invalidate();
      const workbook=XLSX.read(source,{type:"string"});const headers=(XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[workbook.SheetNames[0]],{header:1})[0]??[]).map(String);setColumns(headers);
      const detect=(pattern:RegExp)=>headers.find(h=>pattern.test(h))??"";
      setMapping({date:detect(/date/i),label:detect(/libell|label|description|memo/i),amount:detect(/montant|amount/i),debit:detect(/d[eé]bit/i),credit:detect(/cr[eé]dit/i),externalId:""});
    }}/></Field></div>
    {format==="csv"&&<div className="hh-row">{(["date","label","amount","debit","credit","externalId"] as const).map(key=><Field key={key} label={{date:"Date",label:"Libellé",amount:"Montant signé",debit:"Débit",credit:"Crédit",externalId:"Identifiant bancaire (facultatif)"}[key]}><select value={mapping[key]} onChange={e=>{setMapping({...mapping,[key]:e.target.value});invalidate();}}><option value="">—</option>{columns.map(c=><option key={c}>{c}</option>)}</select></Field>)}</div>}
    <button className="hh-primary" disabled={!content||busy} onClick={async()=>{
      setBusy(true);setError("");try{const {data}=await api.post<{rows:ImportRow[];invalid:number}>("/household/imports/preview",{accountId,format,content,mapping});setPreview(data);setRevision(state.revision);setSelected(data.rows.filter(r=>!r.duplicate).map(r=>r.index));}catch(error){setError(errorMessage(error));}finally{setBusy(false);}
    }}>Prévisualiser</button>
    {error&&<p role="alert" className="hh-error">{error}</p>}{notice&&<p role="status" className="hh-notice">{notice}</p>}
    {preview&&<><p>{preview.rows.length} lignes lisibles · {preview.invalid} lignes invalides · {preview.rows.filter(r=>r.duplicate==="definite").length} doublons certains · {preview.rows.filter(r=>r.duplicate==="possible").length} doublons possibles · {selected.length} sélectionnées</p>
    <div className="hh-table-wrap"><table><thead><tr><th>Importer</th><th>Date</th><th>Libellé</th><th>Montant</th><th>Contrôle</th></tr></thead><tbody>{preview.rows.map(row=><tr key={row.index}><td><input aria-label={"Importer ligne "+(row.index+1)} type="checkbox" disabled={row.duplicate==="definite"} checked={selected.includes(row.index)} onChange={e=>setSelected(e.target.checked?[...selected,row.index]:selected.filter(i=>i!==row.index))}/></td><td>{row.date}</td><td>{row.label}</td><td>{euros(row.cents)}</td><td>{row.duplicate==="definite"?"Déjà importé":row.duplicate==="possible"?"Doublon possible":"Nouveau"}</td></tr>)}</tbody></table></div>
    <p><button className="hh-primary" disabled={busy||!selected.length} onClick={async()=>{
      setBusy(true);setError("");try{const {data}=await api.post<HouseholdState>("/household/imports/commit",{revision,accountId,format,content,mapping,selectedRows:selected});const result=data.history[data.history.length-1]?.after as {imported:number;skipped:number;invalid:number};setNotice(result.imported+" mouvements importés, "+result.skipped+" ignorés, "+result.invalid+" invalides.");setPreview(null);await onRefresh();}catch(error){setError(errorMessage(error));}finally{setBusy(false);}
    }}>Importer la sélection</button></p></>}
  </section>;
}
