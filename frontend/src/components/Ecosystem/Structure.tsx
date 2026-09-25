import {errorText} from "./liveStore";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { StructureMap } from "./StructureMap";
import { prototypeId, kinds, symbols, useEcosystem, validRelation, openScope, ROOT, type Entity, type EntityKind, type Relation } from "./model";

export function Dialog({title,children,onClose}:{title:string;children:ReactNode;onClose:()=>void}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{ref.current?.showModal();},[]);
  return <dialog className="eco-dialog" ref={ref} onCancel={onClose} onClose={onClose} aria-label={title}>
    <header><h2>{title}</h2><button aria-label="Fermer le formulaire" onClick={onClose}>×</button></header>{children}
  </dialog>;
}
export function AddEntity({kind,onClose,onCreated}:{kind:EntityKind;onClose:()=>void;onCreated:(id:string)=>void}) {
  const [error,setError]=useState("");const {save}=useEcosystem();const [name,setName]=useState("");const [usage,setUsage]=useState("Courant personnel");const [companyType,setCompanyType]=useState("Entreprise");
  return <Dialog title={"Ajouter · "+kinds[kind]} onClose={onClose}><form onSubmit={async e=>{
    e.preventDefault();if(!name.trim())return;const id=prototypeId();try{await save({id,kind,name:name.trim(),...(kind==="account"?{usage}:kind==="company"?{companyType}:{})});onCreated(id);onClose();}catch(e){setError(errorText(e));}
  }}>
    <label>Nom<input autoFocus required value={name} onChange={e=>setName(e.target.value)} placeholder={kind==="account"?"Ex. Livret commun":kind==="company"?"Ex. Nouvelle activité":"Prénom"}/></label>
    {kind==="company"&&<label>Type d’entreprise<select value={companyType} onChange={e=>setCompanyType(e.target.value)}>{["Entreprise","Holding","SCI","Autre"].map(t=><option key={t}>{t}</option>)}</select></label>}
    {kind==="account"&&<label>Usage<select value={usage} onChange={e=>setUsage(e.target.value)}>{["Courant personnel","Professionnel","Charges fixes","Quotidien","Épargne","Autre"].map(s=><option key={s}>{s}</option>)}</select></label>}
    <p className="eco-muted">Vous pourrez relier cet élément aux personnes, entreprises et comptes de votre choix.</p>
    <p role="alert">{error}</p><footer><button type="button" onClick={onClose}>Annuler</button><button className="eco-primary">Ajouter</button></footer>
  </form></Dialog>;
}
export function AddRelation({onClose}:{onClose:()=>void}) {
  const [error,setError]=useState("");const {entities,relations,connect}=useEcosystem();const [kind,setKind]=useState<Relation["kind"]>("holder");const [from,setFrom]=useState("");const [to,setTo]=useState("");
  const candidate={kind,from,to};const duplicate=relations.some(r=>r.kind===kind&&r.from===from&&r.to===to);
  const sources=entities.filter(e=>kind==="holder"?e.kind!=="account":kind==="activity"?e.kind==="person":kind==="subsidiary"?e.kind==="company":e.kind==="account");
  const targets=entities.filter(e=>kind==="holder"?e.kind==="account":e.kind==="company");
  return <Dialog title="Créer une relation" onClose={onClose}><form onSubmit={async e=>{e.preventDefault();if(!validRelation(candidate,entities,relations)||duplicate)return;try{await connect(candidate);onClose();}catch(e){setError(errorText(e));}}}>
    <label>Relation<select value={kind} onChange={e=>{setKind(e.target.value as Relation["kind"]);setFrom("");setTo("");}}>
      <option value="holder">Est titulaire du compte</option><option value="activity">Exerce dans l’entreprise</option><option value="usage">Compte utilisé pour l’entreprise</option><option value="subsidiary">Entreprise → participation dans une entreprise</option>
    </select></label>
    <label>De<select required value={from} onChange={e=>setFrom(e.target.value)}><option value="">Choisir…</option>{sources.map(e=><option value={e.id} key={e.id}>{e.name}</option>)}</select></label>
    <label>Vers<select required value={to} onChange={e=>setTo(e.target.value)}><option value="">Choisir…</option>{targets.map(e=><option value={e.id} key={e.id}>{e.name}</option>)}</select></label>
    <p className="eco-muted">{kind==="subsidiary"?"De : entreprise mère (ex. holding). Vers : entreprise détenue (ex. SCI). La flèche va de la mère vers la participation.":"Pour un compte joint, ajoutez une relation de titulaire pour chaque personne."}</p>
    {kind==="subsidiary"&&from&&to&&!validRelation(candidate,entities,relations)&&<p role="alert">Cette relation créerait une boucle dans la hiérarchie.</p>}
    {error&&<p role="alert">{error}</p>}{duplicate&&<p role="alert">Cette relation existe déjà.</p>}
    <footer><button type="button" onClick={onClose}>Annuler</button><button className="eco-primary" disabled={!validRelation(candidate,entities,relations)||duplicate}>Créer la relation</button></footer>
  </form></Dialog>;
}
function Inspector({entity,onSelect,onConnect}:{entity:Entity;onSelect:(id:string)=>void;onConnect:()=>void}) {
  const [error,setError]=useState("");const {entities,relations,save,disconnect}=useEcosystem();const [name,setName]=useState(entity.name);const [usage,setUsage]=useState(entity.usage??"Courant personnel");const [saved,setSaved]=useState(false);const [companyType,setCompanyType]=useState(entity.companyType??"Entreprise");
  const links=relations.filter(r=>r.from===entity.id||r.to===entity.id);
  return <aside className="eco-inspector" aria-label="Propriétés de l’élément">
    <div className="eco-eyebrow">{kinds[entity.kind]}</div><h2>{entity.name}</h2>
    <form onSubmit={async e=>{e.preventDefault();if(name.trim()){try{await save({...entity,name:name.trim(),...(entity.kind==="account"?{usage}:entity.kind==="company"?{companyType}:{})});setSaved(true);}catch(e){setError(errorText(e));}}}}>
      <label>Nom de l’élément<input required value={name} onChange={e=>{setName(e.target.value);setSaved(false);}}/></label>
      {entity.kind==="company"&&<label>Type d’entreprise<select value={companyType} onChange={e=>{setCompanyType(e.target.value);setSaved(false);}}>{["Entreprise","Holding","SCI","Autre"].map(t=><option key={t}>{t}</option>)}</select></label>}
      {entity.kind==="account"&&<label>Usage<select value={usage} onChange={e=>{setUsage(e.target.value);setSaved(false);}}>{["Courant personnel","Professionnel","Charges fixes","Quotidien","Épargne","Autre"].map(s=><option key={s}>{s}</option>)}</select></label>}
      {error&&<p role="alert">{error}</p>}<button type="submit">Enregistrer les propriétés</button>{saved&&<p role="status" className="eco-muted">Propriétés enregistrées.</p>}
    </form>
    <h3>Relations · {links.length}</h3>
    {!links.length&&<p className="eco-muted">Aucune relation. Reliez cet élément pour l’intégrer à votre structure.</p>}
    {links.map(r=>{
      const other=entities.find(e=>e.id===(r.from===entity.id?r.to:r.from));
      const label=r.kind==="subsidiary"?(r.to===entity.id?"Entreprise mère":"Participation détenue"):r.kind==="holder"?(r.to===entity.id?"Titulaire":"Compte détenu"):r.kind==="activity"?(r.to===entity.id?"Personne associée":"Activité"):(r.to===entity.id?"Compte utilisé":"Entreprise associée");
      return <div className="eco-relation" key={r.id}><div><small>{label}</small><button className="eco-text" onClick={()=>other&&onSelect(other.id)}>{other?.name}</button></div><button aria-label={"Retirer la relation avec "+other?.name} onClick={()=>disconnect(r.id)}>×</button></div>;
    })}
    <button onClick={onConnect}>+ Relation</button>
    <h3>Explorer</h3>
    <button className="eco-primary" onClick={()=>openScope({view:"transactions",scope:entity.id})}>Ouvrir les mouvements ↗</button>
    {entity.kind==="company"&&<button onClick={()=>openScope({view:"placeholder",scope:entity.id,label:"Dashboard"})}>Ouvrir l’entreprise ↗</button>}
    <button onClick={()=>openScope({view:"flows",scope:entity.id})}>Voir les flux ↗</button>
  </aside>;
}
export function Structure({scope}:{scope:string}) {
  const {entities,relations,layout,setLayout}=useEcosystem();
  const [selected,setSelected]=useState(scope===ROOT?"":scope);
  const [view,setView]=useState("map");const [focus,setFocus]=useState(false);const [zoom,setZoom]=useState(1);
  const [add,setAdd]=useState<EntityKind|null>(null);const [connect,setConnect]=useState(false);const [menu,setMenu]=useState(false);
  const entity=entities.find(e=>e.id===selected);
  const linked=new Set([selected,...relations.filter(r=>r.from===selected||r.to===selected).flatMap(r=>[r.from,r.to])]);
  const visible=entities.filter(e=>!focus||!selected||linked.has(e.id));
  const columns:EntityKind[]=["person","company","account"];
  return <div className="eco-work">
    <div className="eco-heading"><div><div className="eco-eyebrow">ÉCOSYSTÈME / VUE D’ENSEMBLE</div><h1>Structure financière</h1><p className="eco-muted">Personnes, entreprises et comptes. Sélectionnez un élément pour explorer ses relations.</p></div>
      <div className="eco-actions"><button onClick={()=>openScope({view:"flows",scope})}>Voir les flux ↗</button><div className="eco-menu-wrap"><button className="eco-primary" aria-expanded={menu} onClick={()=>setMenu(!menu)}>+ Ajouter</button>{menu&&<div className="eco-menu">
        {columns.map(kind=><button key={kind} onClick={()=>{setAdd(kind);setMenu(false);}}>{symbols[kind]} {kinds[kind]}</button>)}<button onClick={()=>{setConnect(true);setMenu(false);}}>↔ Relation</button>
      </div>}</div></div>
    </div>
    <div className="eco-toolbar"><div className="eco-segment"><button aria-pressed={view==="map"} onClick={()=>setView("map")}>Carte</button><button aria-pressed={view==="list"} onClick={()=>setView("list")}>Liste</button></div>
      <span className="eco-muted">{entities.filter(e=>e.kind==="person").length} personnes · {entities.filter(e=>e.kind==="company").length} entreprises · {entities.filter(e=>e.kind==="account").length} comptes</span>
      <label className="eco-inline"><input type="checkbox" disabled={!selected} checked={focus} onChange={e=>setFocus(e.target.checked)}/> Isoler les relations</label>
      {view==="map"&&<label className="eco-inline">Disposition<select aria-label="Disposition de la carte" value={layout} onChange={e=>setLayout(e.target.value as typeof layout)}><option value="columns">Colonnes</option><option value="free">Libre</option><option value="hierarchy">Hiérarchie</option></select></label>}
      {view==="map"&&<label className="eco-inline">Zoom<select aria-label="Zoom de la carte" value={zoom} onChange={e=>setZoom(Number(e.target.value))}><option value={.75}>75 %</option><option value={1}>100 %</option><option value={1.25}>125 %</option></select></label>}
      {selected&&<button onClick={()=>{setSelected("");setFocus(false);}}>Tout désélectionner</button>}
    </div>
    <div className={"eco-split "+(!entity?"eco-no-inspector":"")}>
      <div className="eco-map-area">
        {view==="map"?<StructureMap entities={entities} visible={visible} relations={relations} layout={layout} zoom={zoom} selected={selected} linked={linked} onSelect={setSelected}/>:<div className="eco-entity-list">{columns.map(kind=><section key={kind}><h3>{kind==="person"?"Personnes":kind==="company"?"Entreprises":"Comptes bancaires"}</h3>{visible.filter(e=>e.kind===kind).map(e=><button key={e.id} aria-pressed={selected===e.id} onClick={()=>setSelected(e.id)}><span>{symbols[e.kind]} {e.name}</span><small>{e.kind==="account"&&e.treasuryAssignments?.length?"Trésorerie dédiée (datée)":e.usage??kinds[e.kind]} →</small></button>)}</section>)}</div>}
        <div className="eco-legend"><span>― Titulaire</span><span>┄ Activité</span><span>┈ Utilisation professionnelle</span><span>→ Participation entre entreprises</span><span>Chaque compte apparaît une seule fois.</span></div>
      </div>
      {entity?<Inspector key={entity.id} entity={entity} onSelect={setSelected} onConnect={()=>setConnect(true)}/>:<div className="eco-map-hint">Cliquez sur une personne, une entreprise ou un compte pour afficher ses propriétés.</div>}
    </div>
    {add&&<AddEntity kind={add} onClose={()=>setAdd(null)} onCreated={id=>{setSelected(id);setFocus(false);}}/>}
    {connect&&<AddRelation onClose={()=>setConnect(false)}/>}
  </div>;
}

