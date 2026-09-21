import { useState, useId } from "react";
import { endpoint, inScope, money, movements, openScope, ROOT, scopeName, useEcosystem, type ScopeTab, type Movement } from "./model";

export function Journey({spec}:{spec:ScopeTab}) {
  const markerId=useId();
  const {entities,relations}=useEcosystem();
  const [period,setPeriod]=useState(spec.period??"2026-09");
  const [selected,setSelected]=useState(spec.record??"");
  const [search,setSearch]=useState("");
  const [validated,setValidated]=useState(false);
  const [list,setList]=useState(false);
  const rows=movements.filter(m=>m.date.startsWith(period)&&inScope(m,spec.scope,entities,relations)&&(!spec.record||spec.view!=="transactions"||m.id===spec.record));
  const filtered=rows.filter(m=>m.label.toLowerCase().includes(search.toLowerCase()));
  const record=movements.find(m=>m.id===(spec.record??selected));
  const accountIds=new Set(entities.filter(e=>e.kind==="account").map(e=>e.id));
  const internal=(m:Movement)=>accountIds.has(m.from)&&accountIds.has(m.to);
  const openMovement=(m:Movement)=>openScope({view:"movement",scope:accountIds.has(m.from)?m.from:m.to,record:m.id,period});
  const scope=scopeName(spec.scope);
  const title=spec.view==="flows"?"Flux financiers":spec.view==="transactions"?"Mouvements bancaires":spec.view==="movement"?"Détail du mouvement":spec.view==="accounting"?"Traitement professionnel":spec.label??"Aperçu";
  const flowIds=[...new Set(rows.flatMap(m=>[m.from,m.to]))];
  const bankNodes=flowIds.filter(id=>accountIds.has(id));
  const pos=new Map<string,{x:number;y:number}>(bankNodes.map((id,i)=>[id,{x:35+i%3*280,y:175+Math.floor(i/3)*190}]));
  const graphHeight=Math.max(560,Math.ceil(bankNodes.length/3)*190+190);
  pos.set("clients",{x:315,y:25});pos.set("expenses",{x:315,y:graphHeight-85});
  return <div className="eco-work">
    <div className="eco-heading"><div><div className="eco-eyebrow">NOTRE FOYER / {scope.toUpperCase()}</div><h1>{title}</h1><p className="eco-muted">{spec.view==="flows"?"Suivez les mouvements entre vos comptes et l’extérieur.":"Aperçu de navigation · exemples fictifs pour valider le parcours."}</p></div><button onClick={()=>openScope({view:"structure",scope:ROOT})}>Retour à la structure ↗</button></div>
    {(spec.view==="flows"||spec.view==="transactions")&&<div className="eco-toolbar">
      <label className="eco-inline">Période<select aria-label="Période" value={period} onChange={e=>{setPeriod(e.target.value);setSelected("");}}><option value="2026-09">Septembre 2026</option><option value="2026-08">Août 2026</option></select></label>
      <span className="eco-scope-badge">Périmètre : {scope}</span>
      {spec.view==="flows"?<div className="eco-segment"><button aria-pressed={!list} onClick={()=>setList(false)}>Diagramme</button><button aria-pressed={list} onClick={()=>setList(true)}>Liste des flux</button></div>:<label className="eco-inline">Rechercher<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Libellé du mouvement"/></label>}
    </div>}
    {spec.view==="flows"&&<>
      <div className="eco-flow-summary"><span>Entrées externes <strong>{money(rows.filter(m=>!accountIds.has(m.from)).reduce((s,m)=>s+m.cents,0))}</strong></span><span>Sorties externes <strong>{money(rows.filter(m=>!accountIds.has(m.to)).reduce((s,m)=>s+m.cents,0))}</strong></span><small>Les virements entre comptes restent visibles sur le diagramme.</small></div>
      <div className="eco-split">
        <div className="eco-map-area">
          {!rows.length?<p className="eco-empty">Aucun mouvement fictif pour ce périmètre et cette période.</p>:list?<div className="eco-flow-list">{rows.map(m=><button key={m.id} aria-pressed={selected===m.id} onClick={()=>setSelected(m.id)}><span>{endpoint(m.from)} → {endpoint(m.to)}<small>{m.label}</small></span><strong>{money(m.cents)}</strong></button>)}</div>:<div className="eco-map-scroll"><div className="eco-flow-canvas" style={{width:850,height:graphHeight}}>
            <svg width="850" height={graphHeight} aria-label="Diagramme des flux de la période"><defs><marker id={"arrow-"+markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--vscode-accent)"/></marker></defs>
              {rows.map((m,i)=>{const a=pos.get(m.from)!,b=pos.get(m.to)!;const ax=a.x+218,ay=a.y+36;
                const gutter=ax+12+(i%3)*5;
                const above=b.y<=a.y;
                const by=b.y+(above?72:0), corridor=by+(above?20:-20);
                const bx=b.x+109;
                const d="M "+ax+" "+ay+" H "+gutter+" V "+corridor+" H "+bx+" V "+by;
                return <g key={m.id} role="button" tabIndex={0} aria-label={m.label+" : "+money(m.cents)} onClick={()=>setSelected(m.id)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();setSelected(m.id);}}} className="eco-flow-edge">
                  <path d={d} stroke="transparent" strokeWidth="22" fill="none"/>
                  <path d={d} stroke="var(--vscode-accent)" strokeWidth={selected===m.id?4:2} opacity={selected && selected!==m.id ? .22 : .8} strokeDasharray={internal(m)?"6 4":undefined} fill="none" markerEnd={"url(#arrow-"+markerId+")"}/>
                  <title>{endpoint(m.from)+" → "+endpoint(m.to)+" · "+money(m.cents)}</title>
                </g>;
              })}
            </svg>
            {flowIds.map(id=>{const p=pos.get(id)!;return <button key={id} className="eco-node" style={{left:p.x,top:p.y}} onClick={()=>accountIds.has(id)?openScope({view:"transactions",scope:id,period}):setList(true)}><span><strong>{endpoint(id)}</strong><small>{accountIds.has(id)?"Ouvrir les mouvements ↗":"Flux externes · voir la liste"}</small></span></button>;})}
          </div></div>}
          <div className="eco-legend"><span>→ Entrée / sortie externe</span><span>┄→ Virement interne</span><span>Sélectionnez une flèche pour voir son montant.</span></div>
        </div>
        <aside className="eco-inspector" aria-label="Détail du flux"><div className="eco-eyebrow">FLUX SÉLECTIONNÉ</div>{record&&rows.some(m=>m.id===record.id)?<>
          <h2>{record.label}</h2><div className="eco-big-amount">{money(record.cents)}</div><p>{record.date}</p><h3>De</h3><p>{endpoint(record.from)}</p><h3>Vers</h3><p>{endpoint(record.to)}</p><p className="eco-muted">{internal(record)?"Virement interne · une seule opération entre deux comptes.":"Mouvement avec l’extérieur."}</p>
          <button className="eco-primary" onClick={()=>openMovement(record)}>Ouvrir le mouvement ↗</button>
        </>:<><h2>Où va votre argent ?</h2><p className="eco-muted">Sélectionnez une flèche ou un flux ci-dessous.</p>{rows.map(m=><button className="eco-flow-choice" key={m.id} onClick={()=>setSelected(m.id)}><span>{m.label}</span><strong>{money(m.cents)}</strong></button>)}</>}</aside>
      </div>
    </>}
    {spec.view==="transactions"&&<div className="eco-table-wrap"><table><thead><tr><th>Date</th><th>Mouvement</th><th>Compte source → destination</th><th>Montant</th><th>Traitement</th></tr></thead><tbody>{filtered.map(m=><tr key={m.id}><td>{m.date}</td><td><button className="eco-text" onClick={()=>openMovement(m)}>{m.label} ↗</button></td><td>{endpoint(m.from)}<br/><span className="eco-muted">→ {endpoint(m.to)}</span></td><td>{money(m.cents)}</td><td>{m.professional?"Mixte · professionnel et personnel":internal(m)?"Virement interne":"À vérifier"}</td></tr>)}</tbody></table>{!filtered.length&&<p className="eco-empty">Aucun exemple pour ces filtres. Les nouveaux comptes démarrent sans mouvement.</p>}</div>}
    {(spec.view==="movement"||spec.view==="accounting")&&(record?<div className="eco-detail">
      <section className="eco-detail-main"><div className="eco-eyebrow">{spec.view==="accounting"?"ENTREPRISE · "+scope:"MOUVEMENT BANCAIRE · "+record.id.toUpperCase()}</div><h2>{record.label}</h2><div className="eco-big-amount">{money(record.cents)}</div><p>{record.date} · {endpoint(record.from)} → {endpoint(record.to)}</p>
        <h3>Affectations proposées</h3>
        {record.professional&&record.company?<><div className="eco-allocation"><span>{scopeName(record.company)}<small>Part professionnelle</small></span><strong>{money(record.professional)}</strong></div><div className="eco-allocation"><span>Personnel<small>Part personnelle</small></span><strong>{money(record.cents-record.professional)}</strong></div></>:<p>{internal(record)?"Virement entre comptes · aucune dépense supplémentaire.":"Affectation à vérifier dans le parcours final."}</p>}
        <h3>Justificatif</h3><div className="eco-receipt">▤ Facture d’exemple <span className="eco-muted">Emplacement du document</span></div>
        {spec.view==="accounting"?<><h3>Traitement dans l’entreprise</h3><p>Montant professionnel proposé : <strong>{money(record.professional??record.cents)}</strong></p><p className="eco-muted">Les champs comptables, la TVA et le journal seront intégrés ici après validation de ce parcours.</p><button className="eco-primary" onClick={()=>setValidated(!validated)}>{validated?"Annuler la simulation":"Simuler la validation"}</button>{validated&&<p role="status">Validation simulée dans cet onglet.</p>}</>:record.company&&<button className="eco-primary" onClick={()=>openScope({view:"accounting",scope:record.company!,record:record.id,period})}>Ouvrir le traitement · {scopeName(record.company)} ↗</button>}
      </section>
      <aside className="eco-inspector"><div className="eco-eyebrow">CONTEXTE CONSERVÉ</div><h2>Le même mouvement</h2><p className="eco-muted">Le détail bancaire et le traitement professionnel restent liés. Chaque vue garde son propre onglet.</p>
        <button onClick={()=>openMovement(record)}>Mouvement bancaire ↗</button>{record.company&&<button onClick={()=>openScope({view:"placeholder",scope:record.company!,label:"Dashboard"})}>Entreprise · {scopeName(record.company)} ↗</button>}
        <button onClick={()=>openScope({view:"transactions",scope:spec.view==="accounting"?record.from:spec.scope,period})}>Liste des mouvements ↗</button><button onClick={()=>openScope({view:"flows",scope:ROOT,period})}>Flux · Notre foyer ↗</button>
      </aside>
    </div>:<p className="eco-empty">Cet exemple n’existe pas. Ouvrez un mouvement depuis la liste.</p>)}
    {spec.view==="placeholder"&&<div className="eco-placeholder"><div className="eco-eyebrow">APERÇU · {scope}</div><h2>{spec.label}</h2><p>Emplacement du module {spec.label?.toLowerCase()} pour ce périmètre.</p><p className="eco-muted">La navigation et les onglets sont actifs. Le contenu métier sera repris depuis l’application existante.</p><div className="eco-actions"><button className="eco-primary" onClick={()=>openScope({view:"transactions",scope:spec.scope})}>Explorer les mouvements ↗</button><button onClick={()=>openScope({view:"flows",scope:spec.scope})}>Voir les flux ↗</button></div></div>}
  </div>;
}

