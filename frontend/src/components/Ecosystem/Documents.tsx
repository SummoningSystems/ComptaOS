import { useState } from "react";
import { Dialog } from "./Structure";
import { documentTypes, matchDocument, useDocuments, type EcoDocument, type DocumentKind } from "./documentsModel";
import { ROOT, movements, openScope, prototypeId, scopeName, useEcosystem, type ScopeTab } from "./model";

function DocumentForm({document,scope,category,onClose,onSaved}:{document?:EcoDocument;scope:string;category?:string;onClose:()=>void;onSaved:(id:string)=>void}) {
  const {entities}=useEcosystem();const {save}=useDocuments();
  const [draft,setDraft]=useState<EcoDocument>(()=>document?structuredClone(document):{
    id:prototypeId(),name:"",kind:category&&category in documentTypes?category as DocumentKind:"receipt",
    date:"2026-09-21",links:scope===ROOT?[]:[scope],
  });
  return <Dialog title={document?"Modifier les liens du document":"Ajouter un document d’exemple"} onClose={onClose}>
    <form onSubmit={e=>{e.preventDefault();if(!draft.name.trim())return;save({...draft,name:draft.name.trim()});onSaved(draft.id);onClose();}}>
      <label>Nom du document<input required autoFocus value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
      <div className="eco-doc-form-row"><label>Type<select value={draft.kind} onChange={e=>setDraft({...draft,kind:e.target.value as DocumentKind})}>{Object.entries(documentTypes).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
      <label>Date<input required type="date" value={draft.date} onChange={e=>setDraft({...draft,date:e.target.value})}/></label></div>
      <label>Fichier d’exemple (facultatif)<input type="file" onChange={e=>{const file=e.target.files?.[0];if(file)setDraft({...draft,fileName:file.name,name:draft.name||file.name});}}/></label>
      <p className="eco-muted">Prototype : seul le nom du fichier est conservé. Aucun contenu n’est importé.</p>
      <fieldset className="eco-doc-links"><legend>Liens directs</legend>{entities.map(entity=><label key={entity.id}><input type="checkbox" checked={draft.links.includes(entity.id)} onChange={e=>setDraft({...draft,links:e.target.checked?[...draft.links,entity.id]:draft.links.filter(id=>id!==entity.id)})}/>{entity.name}</label>)}</fieldset>
      <p className="eco-muted">{scope===ROOT?"Choisissez les personnes, entreprises ou comptes concernés.":"Lien proposé depuis ce périmètre : "+scopeName(scope)+". Vous pouvez le modifier."}</p>
      <label>Mouvement associé<select value={draft.movementId??""} onChange={e=>setDraft({...draft,movementId:e.target.value||undefined})}><option value="">Aucun</option>{movements.map(m=><option key={m.id} value={m.id}>{m.date+" · "+m.label}</option>)}</select></label>
      <footer><button type="button" onClick={onClose}>Annuler</button><button className="eco-primary" disabled={!draft.name.trim()}>Enregistrer le document</button></footer>
    </form>
  </Dialog>;
}
export function Documents({spec}:{spec:ScopeTab}) {
  const {entities,relations}=useEcosystem();const {documents}=useDocuments();
  const [filter,setFilter]=useState<"all"|"direct"|"associated">("all");
  const [search,setSearch]=useState("");const [selected,setSelected]=useState("");
  const [form,setForm]=useState<EcoDocument|null|undefined>(undefined);
  const [notice,setNotice]=useState("");
  const matches=documents.map(document=>({document,match:matchDocument(document,spec.scope,entities,relations)}))
    .filter(row=>row.match&&(!spec.category||row.document.kind===spec.category));
  const rows=matches.filter(({document,match})=>(filter==="all"||match?.kind===filter)&&document.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const active=matches.find(row=>row.document.id===selected);
  const doc=active?.document;const movement=movements.find(m=>m.id===doc?.movementId);
  const root=spec.scope===ROOT;
  return <div className="eco-work">
    <div className="eco-heading"><div><div className="eco-eyebrow">ÉCOSYSTÈME / {scopeName(spec.scope).toUpperCase()}</div>
      <h1>{spec.category?documentTypes[spec.category as DocumentKind]??"Documents":"Documents"}</h1>
      <p className="eco-muted">Une bibliothèque partagée. Les liens déterminent où chaque document apparaît.</p></div>
      <button className="eco-primary" onClick={()=>setForm(null)}>+ Ajouter un document</button>
    </div>
    <div className="eco-toolbar"><span className="eco-scope-badge">Documents · {scopeName(spec.scope)}</span>
      <div className="eco-segment"><button aria-pressed={filter==="all"} onClick={()=>setFilter("all")}>Tous ({matches.length})</button>
        {!root&&<><button aria-pressed={filter==="direct"} onClick={()=>setFilter("direct")}>Directement liés ({matches.filter(r=>r.match?.kind==="direct").length})</button>
        <button aria-pressed={filter==="associated"} onClick={()=>setFilter("associated")}>Éléments associés ({matches.filter(r=>r.match?.kind==="associated").length})</button></>}
      </div>
      <label className="eco-inline">Rechercher un document<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Nom du document"/></label>
    </div>
    {notice&&<p role="status" className="eco-muted">{notice}</p>}
    <div className={"eco-doc-grid "+(!doc?"eco-doc-full":"")}>
      <div className="eco-table-wrap"><table aria-label="Documents du périmètre"><thead><tr><th>Document</th><th>Type / Date</th><th>{root?"Liens":"Pourquoi ici ?"}</th></tr></thead>
        <tbody>{rows.map(({document,match})=><tr key={document.id} data-selected={doc?.id===document.id}>
          <td><button className="eco-text" onClick={()=>setSelected(document.id)}>{document.name}</button><small className="eco-muted">{document.fileName??"Document d’exemple"}</small></td>
          <td>{documentTypes[document.kind]}<br/><small className="eco-muted">{document.date}</small></td>
          <td>{root?<><span>{document.links.length?document.links.map(scopeName).join(" · "):document.movementId?"Lié à un mouvement":"Sans lien"}</span></>:<><span className="eco-doc-badge">{match?.kind==="direct"?"Directement lié":"Élément associé"}</span><small className="eco-doc-reason">{match?.reasons.join(" / ")}</small></>}</td>
        </tr>)}</tbody></table>
        {!rows.length&&<p className="eco-empty">Aucun document pour ces filtres. Ajoutez un exemple ou modifiez les liens d’un document depuis la vue d’ensemble.</p>}
      </div>
      {doc&&<aside className="eco-inspector" aria-label="Détail du document">
        <div className="eco-eyebrow">BIBLIOTHÈQUE PARTAGÉE</div><h2>{doc.name}</h2>
        <div className="eco-document-paper"><span>▤</span><strong>{documentTypes[doc.kind]}</strong><small>{doc.date}</small><p>Aperçu d’exemple</p></div>
        <h3>Pourquoi ce document apparaît ici</h3>{active?.match?.reasons.map(reason=><p key={reason}>{reason}</p>)}
        <h3>Liens directs</h3>{doc.links.map(id=><button key={id} onClick={()=>openScope({view:"documents",scope:id})}>{scopeName(id)} ↗</button>)}
        {!doc.links.length&&<p className="eco-muted">Aucun lien direct.</p>}
        {movement&&<><h3>Mouvement associé</h3><button onClick={()=>openScope({view:"movement",scope:entities.some(e=>e.id===movement.from)?movement.from:movement.to,record:movement.id})}>{movement.label} ↗</button></>}
        <button className="eco-primary" onClick={()=>setForm(doc)}>Modifier les liens</button>
        <p className="eco-muted">Ces liens sont communs à toutes les vues. Le document reste enregistré une seule fois.</p>
      </aside>}
    </div>
    {form!==undefined&&<DocumentForm document={form??undefined} scope={spec.scope} category={spec.category} onClose={()=>setForm(undefined)} onSaved={id=>{setSelected(id);setNotice("Document enregistré dans la bibliothèque partagée.");}}/>}
  </div>;
}

