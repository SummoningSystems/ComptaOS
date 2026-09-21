import {errorText} from "./liveStore";
import { useState } from "react";
import { ROOT, scopeName, useEcosystem, type ScopeTab } from "./model";
import { accountingEnabled, vatEnabled } from "./navigation";
export function ScopeSettings({spec,live=false}:{spec:ScopeTab;live?:boolean}) {
  const {entities,save}=useEcosystem();const entity=entities.find(e=>e.id===spec.scope);
  const [name,setName]=useState(entity?.name??"");
  const [accounting,setAccounting]=useState(accountingEnabled(entity));
  const [vat,setVat]=useState(vatEnabled(entity));
  const [notice,setNotice]=useState("");
  const [error,setError]=useState("");
  const [archived,setArchived]=useState(entity?.archived??false);
  const [target,setTarget]=useState(entity?.defaultTarget??ROOT);
  const [opening,setOpening]=useState(entity?.opening);
  const [bankIdentifier,setBankIdentifier]=useState(entity?.bankIdentifier??"");

  return <div className="eco-work"><div className="eco-heading"><div><div className="eco-eyebrow">ÉCOSYSTÈME / {scopeName(spec.scope).toUpperCase()}</div><h1>Paramètres du périmètre</h1><p className="eco-muted">Ces réglages concernent uniquement {scopeName(spec.scope)}.</p></div></div>
    {spec.scope===ROOT?<div className="eco-placeholder"><h2>Configuration de l’écosystème</h2><p>Personnes, entreprises et comptes se configurent dans Structure.</p><p className="eco-muted">Les réglages communs du serveur et des accès sont regroupés sous Application, dans la barre supérieure.</p></div>
    :entity&&<form className="eco-settings-form" onSubmit={async e=>{e.preventDefault();if(!name.trim())return;try{await save({...entity,name:name.trim(),archived,...(entity.kind==="company"?{accountingEnabled:accounting,vatEnabled:accounting&&vat}:entity.kind==="account"?{defaultTarget:target,opening,bankIdentifier}:{})});setError("");setNotice("Réglages enregistrés. Les outils disponibles ont été mis à jour.");}catch(e){setError(errorText(e));}}}>
      <label>Nom du périmètre<input required value={name} onChange={e=>setName(e.target.value)}/></label>
      {entity.kind==="company"&&<><h2>Outils comptables</h2><p className="eco-muted">Le type Entreprise, Holding ou SCI ne détermine pas les outils activés.</p>
        <label className="eco-inline"><input type="checkbox" checked={accounting} onChange={e=>setAccounting(e.target.checked)}/> Activer la comptabilité</label>
        <label className="eco-inline"><input type="checkbox" disabled={!accounting} checked={vat} onChange={e=>setVat(e.target.checked)}/> Activer le suivi de TVA</label>
        {!live&&<p className="eco-muted">Configuration de navigation du prototype. Les modules comptables restent des aperçus.</p>}
      </>}
      {entity.kind==="account"&&<p className="eco-muted">Les titulaires et l’utilisation professionnelle se configurent dans Structure. Le rapprochement apparaît quand le compte est lié à une entreprise dont la comptabilité est activée.</p>}
      {live&&entity.kind==="account"&&<>
      <label>IBAN (facultatif)<input value={bankIdentifier} onChange={e=>setBankIdentifier(e.target.value)}/></label><label>Affectation par défaut<select value={target} onChange={e=>setTarget(e.target.value)}><option value={ROOT}>Vie commune</option>{entities.filter(e=>e.kind!=="account"&&!e.archived).map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
      <label className="eco-inline"><input type="checkbox" checked={!!opening} onChange={e=>setOpening(e.target.checked?{date:new Date().toISOString().slice(0,10),cents:0}:undefined)}/> Renseigner un solde initial</label>
      {opening&&<><label>Date du solde au début de journée<input type="date" required value={opening.date} onChange={e=>setOpening({...opening,date:e.target.value})}/></label><label>Solde initial EUR<input type="number" step=".01" value={opening.cents/100} onChange={e=>setOpening({...opening,cents:Math.round(Number(e.target.value)*100)})}/></label></>}
      </>}
      {live&&<label className="eco-inline"><input type="checkbox" checked={archived} onChange={e=>setArchived(e.target.checked)}/> Archiver (historique conservé)</label>}
      {error&&<p role="alert">{error}</p>}<button className="eco-primary">Enregistrer les paramètres</button>{notice&&<p role="status">{notice}</p>}
    </form>}
  </div>;
}

