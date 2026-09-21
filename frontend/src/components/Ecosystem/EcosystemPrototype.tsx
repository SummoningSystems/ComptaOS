import { useEffect, useState } from "react";
import { Sidebar, type SidebarSection } from "../Layout/Sidebar";
import { WorkspaceLayout } from "../Layout/WorkspaceLayout";
import { StatusBar } from "../Layout/StatusBar";
import { useAppStore } from "../../stores/appStore";
import { Structure, Dialog } from "./Structure";
import { Journey } from "./Journey";
import { kinds, symbols, ROOT, openScope, parseTab, scopeName, useEcosystem, type Entity } from "./model";
import type { Tab } from "../../types";
import "./ecosystem.css";

const viewTitles={structure:"Structure",flows:"Flux",transactions:"Mouvements",movement:"Mouvement",accounting:"Traitement",placeholder:"Aperçu"};
export default function EcosystemPrototype() {
  const {entities,reset}=useEcosystem();
  const {tabs,activeTabId}=useAppStore();
  const [section,setSection]=useState<SidebarSection>("ecosystem");
  const [search,setSearch]=useState<string|null>(null);
  const [resetOpen,setResetOpen]=useState(false);
  const [help,setHelp]=useState(false);
  const active=tabs.find(t=>t.id===activeTabId);
  const spec=parseTab(active?.path);
  const entity=entities.find(e=>e.id===spec.scope);

  useEffect(()=>{
    useAppStore.setState({tabs:[],activeTabId:null});
    const initial=new URLSearchParams(location.search).get("prototypeTab");
    openScope(initial?parseTab(initial):{view:"structure",scope:ROOT});
  },[]);
  useEffect(()=>{
    setSection(entity?.kind==="company"?"compta":"ecosystem");
  },[entity?.kind,spec.scope]);
  useEffect(()=>{
    const current=useAppStore.getState().tabs;
    useAppStore.setState({tabs:current.map(t=>{
      const s=parseTab(t.path);
      return {...t,title:(s.label??viewTitles[s.view])+" · "+scopeName(s.scope)};
    })});
  },[entities]);
  useEffect(()=>{
    function onKey(e:KeyboardEvent){if((e.ctrlKey||e.metaKey)&&e.key==="k"){e.preventDefault();setSearch("");}}
    window.addEventListener("keydown",onKey);return()=>window.removeEventListener("keydown",onKey);
  },[]);

  const openEntity=(e:Entity)=>openScope({view:e.kind==="company"?"placeholder":e.kind==="account"?"transactions":"structure",scope:e.id,...(e.kind==="company"?{label:"Dashboard"}:{})});
  function navigate(tab:Tab) {
    openScope({view:tab.type==="transactions"?"transactions":tab.type==="treasury"?"flows":"placeholder",scope:spec.scope,label:tab.type==="transactions"||tab.type==="treasury"?undefined:tab.title});
  }
  const ecosystem=<div className="eco-sidebar-content">
    <div className="eco-sidebar-heading">ÉCOSYSTÈME</div>
    <button onClick={()=>openScope({view:"structure",scope:ROOT})} className={spec.view==="structure"?"eco-nav-active":""}>◈ Structure</button>
    <button onClick={()=>openScope({view:"flows",scope:ROOT})} className={spec.view==="flows"?"eco-nav-active":""}>⇄ Flux du foyer</button>
    <button onClick={()=>openScope({view:"transactions",scope:ROOT})}>☷ Tous les mouvements</button>
    {(["person","company","account"] as const).map(kind=><details open key={kind}><summary>{kind==="person"?"Personnes":kind==="company"?"Entreprises":"Comptes"}</summary>{entities.filter(e=>e.kind===kind).map(e=><button key={e.id} className={spec.scope===e.id?"eco-nav-active":""} onClick={()=>openEntity(e)}><span>{symbols[kind]}</span><span>{e.name}</span></button>)}</details>)}
  </div>;
  return <div className="eco-app flex flex-col h-screen bg-vscode-bg text-vscode-text">
    <header className="eco-titlebar flex items-center gap-3 px-4 h-10 bg-vscode-panel border-b border-vscode-border shrink-0">
      <strong className="text-xs text-vscode-muted tracking-wide">ComptaOS</strong>
      <select aria-label="Périmètre actif" value={spec.scope} onChange={e=>{const target=entities.find(n=>n.id===e.target.value);if(target)openEntity(target);else openScope({view:"structure",scope:ROOT});}}>
        <option value={ROOT}>◈ Notre foyer</option>{(["person","company","account"] as const).map(kind=><optgroup key={kind} label={kinds[kind]}>{entities.filter(e=>e.kind===kind).map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</optgroup>)}
      </select>
      <span className="eco-prototype-badge">Prototype · données fictives</span><div className="flex-1"/>
      <button aria-label="Rechercher dans l’écosystème" onClick={()=>setSearch("")}>Rechercher <kbd>Ctrl K</kbd></button><button onClick={()=>setHelp(true)}>Parcours</button><button onClick={()=>setResetOpen(true)}>Réinitialiser</button>
      <a href={import.meta.env.BASE_URL}>Quitter</a>
    </header>
    <WorkspaceLayout sidebar={<Sidebar activeSection={section} onSectionChange={setSection} ecosystem={ecosystem} activeItemTitle={spec.label ?? (spec.view==="transactions"?"Transactions":spec.view==="flows"?"Trésorerie":undefined)} onOpenTab={navigate} explorerContent={<p className="eco-empty">Aperçu des fichiers de {scopeName(spec.scope)}.</p>}/>}>
      <div className="eco-panels flex-1 min-h-0">
        {tabs.filter(t=>t.type==="ecosystem").map(tab=>{
          const s=parseTab(tab.path);
          return <div key={tab.id} role="tabpanel" aria-label={tab.title} hidden={tab.id!==activeTabId} className="eco-panel">{s.view==="structure"?<Structure scope={s.scope}/>:<Journey spec={s}/>}</div>;
        })}
        {!active&&<div className="eco-empty"><h1>Votre écosystème</h1><p>Ouvrez une vue pour poursuivre l’exploration.</p><button onClick={()=>openScope({view:"structure",scope:ROOT})}>Ouvrir la structure</button></div>}
      </div>
    </WorkspaceLayout>
    <StatusBar prototype/>
    {search!==null&&<Dialog title="Rechercher dans l’écosystème" onClose={()=>setSearch(null)}><label>Personne, entreprise ou compte<input autoFocus value={search} onChange={e=>setSearch(e.target.value)}/></label><div className="eco-search-results">{entities.filter(e=>e.name.toLowerCase().includes(search.toLowerCase())).map(e=><button key={e.id} onClick={()=>{openEntity(e);setSearch(null);}}>{symbols[e.kind]} {e.name}<small>{kinds[e.kind]}</small></button>)}</div></Dialog>}
    {resetOpen&&<Dialog title="Réinitialiser le prototype ?" onClose={()=>setResetOpen(false)}><p>Les modifications de la carte dans ce navigateur seront remplacées par l’exemple de départ.</p><footer><button onClick={()=>setResetOpen(false)}>Annuler</button><button className="eco-primary" onClick={()=>{reset();useAppStore.setState({tabs:[],activeTabId:null});openScope({view:"structure",scope:ROOT});setResetOpen(false);}}>Restaurer l’exemple</button></footer></Dialog>}
    {help&&<Dialog title="Parcours à essayer" onClose={()=>setHelp(false)}><ol className="eco-steps"><li>Dans Structure, sélectionnez Commun · Charges. Vérifiez ses deux titulaires.</li><li>Ajoutez un compte Épargne, puis reliez-le aux deux personnes.</li><li>Ouvrez Personnel · Augustin, puis ses mouvements.</li><li>Ouvrez Achat mixte · matériel, puis le traitement Studio Augustin.</li><li>Revenez à Structure ou Flux. Les onglets gardent leur périmètre, leur sélection et leurs filtres.</li></ol><p className="eco-muted">La carte est modifiable. Les mouvements et modules comptables sont des exemples pour évaluer la navigation.</p><footer><button className="eco-primary" onClick={()=>setHelp(false)}>Explorer</button></footer></Dialog>}
  </div>;
}

