import { useState } from "react";
import { ROOT, scopeName, useEcosystem, type ScopeTab } from "./model";
import { accountingEnabled, vatEnabled } from "./navigation";
export function ScopeSettings({spec}:{spec:ScopeTab}) {
  const {entities,save}=useEcosystem();const entity=entities.find(e=>e.id===spec.scope);
  const [name,setName]=useState(entity?.name??"");
  const [accounting,setAccounting]=useState(accountingEnabled(entity));
  const [vat,setVat]=useState(vatEnabled(entity));
  const [notice,setNotice]=useState("");
  return <div className="eco-work"><div className="eco-heading"><div><div className="eco-eyebrow">ÉCOSYSTÈME / {scopeName(spec.scope).toUpperCase()}</div><h1>Paramètres du périmètre</h1><p className="eco-muted">Ces réglages concernent uniquement {scopeName(spec.scope)}.</p></div></div>
    {spec.scope===ROOT?<div className="eco-placeholder"><h2>Configuration de l’écosystème</h2><p>Personnes, entreprises et comptes se configurent dans Structure.</p><p className="eco-muted">Les réglages communs du serveur et des accès sont regroupés sous Application, dans la barre supérieure.</p></div>
    :entity&&<form className="eco-settings-form" onSubmit={e=>{e.preventDefault();if(!name.trim())return;save({...entity,name:name.trim(),...(entity.kind==="company"?{accountingEnabled:accounting,vatEnabled:accounting&&vat}:{})});setNotice("Réglages enregistrés. Les outils disponibles ont été mis à jour.");}}>
      <label>Nom du périmètre<input required value={name} onChange={e=>setName(e.target.value)}/></label>
      {entity.kind==="company"&&<><h2>Outils comptables</h2><p className="eco-muted">Le type Entreprise, Holding ou SCI ne détermine pas les outils activés.</p>
        <label className="eco-inline"><input type="checkbox" checked={accounting} onChange={e=>setAccounting(e.target.checked)}/> Activer la comptabilité</label>
        <label className="eco-inline"><input type="checkbox" disabled={!accounting} checked={vat} onChange={e=>setVat(e.target.checked)}/> Activer le suivi de TVA</label>
        <p className="eco-muted">Configuration de navigation du prototype. Les modules comptables restent des aperçus.</p>
      </>}
      {entity.kind==="account"&&<p className="eco-muted">Les titulaires et l’utilisation professionnelle se configurent dans Structure. Le rapprochement apparaît quand le compte est lié à une entreprise dont la comptabilité est activée.</p>}
      <button className="eco-primary">Enregistrer les paramètres</button>{notice&&<p role="status">{notice}</p>}
    </form>}
  </div>;
}

