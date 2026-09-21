import {useEffect,useMemo,useState,useRef} from "react";
import {useTheme} from "../../hooks/useTheme";
import {api} from "../../api/client";
import {WorkspaceApiProvider} from "../../api/WorkspaceApi";
import {WorkspaceStoreProvider} from "../../stores/WorkspaceStore";
import {useAppStore} from "../../stores/appStore";
import {WorkspaceLayout} from "../Layout/WorkspaceLayout";
import {Sidebar,type SidebarSection} from "../Layout/Sidebar";
import {Structure,Dialog} from "./Structure";
import {useEcosystem,parseTab,openScope,ROOT,scopeName,kinds,type ScopeTab} from "./model";
import {scopeNavigation,sectionFor} from "./navigation";
import {useLive,bindLiveStructure,liveRequest,errorText} from "./liveStore";
import {LiveMovements,LiveMovement,LiveTreatment,LiveImport,LiveTransfers} from "./LiveFinance";
import {LiveOverview,LivePlanning} from "./LiveOverview";
import {LiveDocuments} from "./LiveDocuments";
import {LiveBanking} from "./LiveBanking";
import {ScopeSettings} from "./ScopeSettings";
import {ViewContent} from "../../App";
import {createInvitation,fetchUsers,type AuthUser} from "../../api/auth";
import type {Ecosystem} from "../../types/ecosystem";
import type {Tab,TabType} from "../../types";
import "./ecosystem.css";
export default function LiveApp({user,onLogout}:{user:AuthUser|null;onLogout:()=>Promise<void>}){
 const [list,setList]=useState<{id:string;name:string}[]|null>(null),[chosen,setChosen]=useState(""),[name,setName]=useState("Mon écosystème"),[error,setError]=useState("");const data=useLive(s=>s.data);
 const preference="comptaos_ecosystem_"+(user?.id??"local");
 useEffect(()=>{let active=true;useLive.setState({data:null,error:""});api.get<{id:string;name:string}[]>("ecosystems").then(({data})=>{if(!active)return;setList(data);const wanted=new URLSearchParams(location.search).get("ecosystem")??localStorage.getItem(preference);setChosen(data.find(e=>e.id===wanted)?.id??data[0]?.id??"");}).catch(e=>setError(errorText(e)));return()=>{active=false;};},[preference]);
 useEffect(()=>{if(!chosen)return;let active=true;useLive.getState().load(chosen).then(()=>{if(active){bindLiveStructure();localStorage.setItem(preference,chosen);}}).catch(e=>setError(errorText(e)));return()=>{active=false;};},[chosen,preference]);
 if(chosen&&data?.id===chosen)return <LiveShell key={chosen} user={user} onLogout={onLogout}/>;
 return <main className="eco-app eco-work"><h1>Votre écosystème financier</h1><p>Créez votre espace commun, puis ajoutez les personnes, entreprises et comptes dans Structure.</p>{error&&<p role="alert">{error}</p>}{list===null?<p>Chargement…</p>:list.length?<p>Ouverture de l’espace…</p>:(!user||["owner","admin"].includes(user.role))?<form className="eco-settings-form" onSubmit={async e=>{e.preventDefault();try{const {data}=await api.post<Ecosystem>("ecosystems",{name});useLive.getState().accept(data);bindLiveStructure();setChosen(data.id);}catch(e){setError(errorText(e));}}}><label>Nom de l’espace<input required value={name} onChange={e=>setName(e.target.value)}/></label><button className="eco-primary">Créer l’écosystème</button></form>:<p>Demandez une invitation à l’administrateur de votre espace.</p>}<button onClick={()=>void onLogout()}>Déconnexion</button></main>;
}
const businessTypes:Record<string,TabType>={Dashboard:"dashboard",Journal:"journal","Clôture mensuelle":"closing",TVA:"vat","Bilan / P&L":"profitloss",Tableaux:"spreadsheets","Facturation":"invoices","Créer des devis":"quotes","Profil et comptabilité":"settings",RH:"hr",Rapports:"reports",Export:"export",Modèles:"templates",Tiers:"tiers"};
function LivePanel({spec,user,tabId}:{spec:ScopeTab;user:AuthUser|null;tabId:string}){
 const s=useLive(x=>x.data)!;const entity=s.entities.find(e=>e.id===spec.scope);
 if(spec.view==="structure")return <Structure scope={spec.scope}/>;
 if(spec.view==="documents")return <LiveDocuments spec={spec}/>;
 if(spec.view==="settings")return <ScopeSettings spec={spec} live/>;
 if(spec.view==="transactions")return <LiveMovements spec={spec}/>;
 if(spec.view==="movement")return <LiveMovement spec={spec}/>;
 if(spec.view==="accounting")return <LiveTreatment key={spec.record} spec={spec}/>;
 if(spec.view==="flows")return <LiveOverview spec={spec}/>;
 if(spec.label==="Importer un relevé")return <LiveImport spec={spec}/>;
 if(spec.label==="Connexions bancaires")return <LiveBanking/>;
 if(["Budgets","Frais récurrents"].includes(spec.label??""))return <LivePlanning spec={spec}/>;
 if(spec.label==="Virements")return <LiveTransfers spec={spec}/>;
 if(spec.label==="Historique")return <div className="eco-work"><h1>Historique partagé</h1>{[...s.history].reverse().map((h,i)=><details key={i}><summary>{h.at} · {h.actor} · {h.action}</summary><pre style={{whiteSpace:"pre-wrap"}}>{JSON.stringify(h.details,null,2)}</pre></details>)}</div>;
 if(["À traiter","À traiter par entreprise","Rapprochement"].includes(spec.label??""))return <div className="eco-work"><h1>Traitements à vérifier</h1>{s.treatments.filter(t=>t.transaction.status!=="validated"&&(spec.scope===ROOT||t.companyId===spec.scope||s.movements.some(m=>m.id===t.movementId&&m.accountId===spec.scope))).map(t=><p key={t.transaction.id}><button onClick={()=>openScope({view:"accounting",scope:t.companyId,record:t.transaction.id})}>{scopeName(t.companyId)} · {t.transaction.date} · {t.transaction.label} ↗</button></p>)}</div>;
 const type=spec.businessType??businessTypes[spec.label??""];
 if(entity?.workspaceId&&type)return <WorkspaceApiProvider id={entity.workspaceId}><WorkspaceStoreProvider scope={entity.id}><ViewContent tabId={tabId} type={type} path={spec.businessPath} currentUser={user}/></WorkspaceStoreProvider></WorkspaceApiProvider>;
 return <LiveOverview spec={spec}/>;
}
function LiveShell({user,onLogout}:{user:AuthUser|null;onLogout:()=>Promise<void>}){
 const callbackJob=useRef<Promise<void>|null>(null);
 const {toggle}=useTheme();const {data:s,error,busy}=useLive();const ecosystemId=s!.id;const {entities,relations}=useEcosystem();const {tabs,activeTabId}=useAppStore();const [section,setSection]=useState<SidebarSection>("ecosystem"),[application,setApplication]=useState(false),[search,setSearch]=useState<string|null>(null);
 const spec=useMemo(()=>parseTab(tabs.find(t=>t.id===activeTabId)?.path),[tabs,activeTabId]);
 const groups=useMemo(()=>{const groups=scopeNavigation(spec.scope,entities,relations);const m=groups.find(g=>g.id==="movements");if(m?.items)for(const label of ["Virements","Connexions bancaires"])m.items.push({label,icon:"⇄",tab:{id:label,title:label,type:"ecosystem",path:JSON.stringify({view:"placeholder",scope:spec.scope,label,section:"movements"})}});const company=entities.find(e=>e.id===spec.scope&&e.kind==="company");if(company){const d=groups.find(g=>g.id==="documents");if(d?.items)for(const label of ["Facturation","Créer des devis","Modèles","Tiers","RH","Profil et comptabilité"])d.items.push({label,icon:"▤",tab:{id:label,title:label,type:"ecosystem",path:JSON.stringify({view:"placeholder",scope:spec.scope,label,section:"documents"})}});}return groups;},[spec.scope,entities,relations]);
 useEffect(()=>{setSection(groups.some(g=>g.id===sectionFor(spec))?sectionFor(spec):"ecosystem");},[groups,spec]);
 useEffect(()=>{
  let active=true,ready=false,timer:ReturnType<typeof setTimeout>|undefined;
  useAppStore.setState({tabs:[],activeTabId:null});
  type Preferences={tabs?:Tab[];activeTabId?:string;positions?:Record<string,{x:number;y:number}>;layout?:"columns"|"free"|"hierarchy"};
  void liveRequest<Preferences>("get","preferences").then(p=>{if(!active)return;useEcosystem.setState({positions:p.positions??{},layout:p.layout??"columns"});const urlTab=new URLSearchParams(location.search).get("ecosystemTab");if(urlTab)openScope(parseTab(urlTab));else if(p.tabs?.length){const valid=p.tabs.filter(t=>t.type==="ecosystem"&&(parseTab(t.path).scope===ROOT||useLive.getState().data!.entities.some(e=>e.id===parseTab(t.path).scope)));useAppStore.setState({tabs:valid,activeTabId:valid.some(t=>t.id===p.activeTabId)?p.activeTabId:valid[0]?.id??null});}if(!useAppStore.getState().tabs.length)openScope({view:"structure",scope:ROOT});ready=true;}).catch(()=>{if(active){openScope({view:"structure",scope:ROOT});ready=true;}});
  const save=()=>{if(!ready)return;clearTimeout(timer);timer=setTimeout(()=>{const state=useAppStore.getState(),map=useEcosystem.getState();void liveRequest("put","preferences",{tabs:state.tabs,activeTabId:state.activeTabId,positions:map.positions,layout:map.layout}).catch(()=>undefined);},600);};
  const unsubscribe=useAppStore.subscribe(save),unmap=useEcosystem.subscribe((state,previous)=>{if(state.positions!==previous.positions||state.layout!==previous.layout)save();});
  const reload=()=>{if(!document.hidden)void useLive.getState().load(ecosystemId).catch(()=>undefined);};const poll=setInterval(reload,15000);window.addEventListener("focus",reload);
  const callback=new URLSearchParams(location.search);
  if(callback.has("state")){
    callbackJob.current??=liveRequest("post","banking/callback",{state:callback.get("state")}).then(()=>{
      const url=new URL(location.href);["state","id_connection","connection_id","error","error_description"].forEach(k=>url.searchParams.delete(k));history.replaceState(null,"",url);
      if(callback.has("error"))throw Error("La connexion bancaire n’a pas abouti. Vous pouvez réessayer.");
    });
    void callbackJob.current.then(()=>{if(active){const show=()=>{if(!active)return;if(!ready){setTimeout(show,50);return;}openScope({view:"placeholder",scope:ROOT,label:"Connexions bancaires",section:"movements"});};show();}}).catch(e=>{if(active)useLive.setState({error:errorText(e)});});
  }
  return()=>{active=false;clearTimeout(timer);clearInterval(poll);unsubscribe();unmap();window.removeEventListener("focus",reload);};
 },[ecosystemId]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key==="k"){e.preventDefault();setSearch("");}};window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key);},[]);
 function switchScope(scope:string){openScope({view:["structure","flows","transactions","documents","settings"].includes(spec.view)?spec.view:"placeholder",scope,...(spec.view==="documents"?{category:spec.category}:{}),...(!["structure","flows","transactions","documents","settings"].includes(spec.view)?{label:"Dashboard"}:{})});}
 const tree=<div className="eco-sidebar-content"><button onClick={()=>openScope({view:"placeholder",scope:ROOT,label:"Vue d’ensemble"})}>◈ Vue d’ensemble</button><button onClick={()=>openScope({view:"structure",scope:ROOT})}>◇ Structure</button><button onClick={()=>openScope({view:"flows",scope:ROOT})}>⇄ Tous les flux</button>{(["person","company","account"] as const).map(kind=><details open key={kind}><summary>{kinds[kind]}</summary>{entities.filter(e=>e.kind===kind&&!e.archived).map(e=><button key={e.id} onClick={()=>switchScope(e.id)}>{e.name}</button>)}</details>)}</div>;
 return <div className="eco-app flex flex-col h-screen bg-vscode-bg text-vscode-text"><header className="eco-titlebar"><strong>ComptaOS</strong><select aria-label="Périmètre actif" value={spec.scope} onChange={e=>switchScope(e.target.value)}><option value={ROOT}>Vue d’ensemble</option>{(["person","company","account"] as const).map(kind=><optgroup key={kind} label={kinds[kind]}>{entities.filter(e=>e.kind===kind&&!e.archived).map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</optgroup>)}</select><span className="flex-1"/><button onClick={()=>setSearch("")}>Rechercher</button><button onClick={()=>setApplication(true)}>Application</button><span>{user?.displayName}</span><button onClick={()=>void onLogout()}>Déconnexion</button></header>
 {error&&<div role="alert" className="eco-error">{error} <button onClick={()=>void useLive.getState().load(ecosystemId).then(()=>useLive.setState({error:""})).catch(()=>undefined)}>Recharger</button></div>}
 <WorkspaceLayout sidebar={<Sidebar activeSection={section} onSectionChange={setSection} ecosystem={tree} groups={groups} scopeLabel={scopeName(spec.scope)} onOpenTab={tab=>openScope(parseTab(tab.path))} explorerContent={tree}/>}><div className="eco-panels flex-1 min-h-0">{tabs.filter(t=>t.type==="ecosystem").map(t=><div key={t.id} role="tabpanel" aria-label={t.title} hidden={t.id!==activeTabId} className="eco-panel"><LivePanel spec={parseTab(t.path)} user={user} tabId={t.id}/></div>)}</div></WorkspaceLayout>
 <footer className="eco-live-status"><span>{s!.name} · {busy?"Enregistrement…":"Enregistré sur le serveur"} · révision {s!.revision}</span><span>{user?.role==="readonly"?"Lecture seule":"Espace partagé"}</span></footer>
 {search!==null&&<Dialog title="Rechercher dans l’écosystème" onClose={()=>setSearch(null)}><input aria-label="Rechercher" autoFocus value={search} onChange={e=>setSearch(e.target.value)}/>{entities.filter(e=>e.name.toLowerCase().includes(search.toLowerCase())).map(e=><p key={e.id}><button onClick={()=>{switchScope(e.id);setSearch(null);}}>{e.name}</button></p>)}</Dialog>}
 {application&&<ApplicationSettings toggleTheme={toggle} user={user} onClose={()=>setApplication(false)}/>}</div>;
}
function ApplicationSettings({user,onClose,toggleTheme}:{user:AuthUser|null;onClose:()=>void;toggleTheme:()=>void}){
 const s=useLive(x=>x.data)!;const [users,setUsers]=useState<AuthUser[]>([]),[existing,setExisting]=useState("");const [members,setMembers]=useState<{id:string;displayName:string;role:string}[]>([]),[invite,setInvite]=useState(""),[error,setError]=useState(""),[backup,setBackup]=useState<{enabled:boolean;lastSuccess?:string;error?:string}|null>(null);
 const admin=!user||["owner","admin"].includes(user.role);
 useEffect(()=>{void liveRequest<typeof members>("get","members").then(setMembers).catch(e=>setError(errorText(e)));if(admin)void fetchUsers().then(setUsers).catch(e=>setError(errorText(e)));if(admin)void api.get("backups").then(r=>setBackup(r.data)).catch(e=>setError(errorText(e)));},[admin]);
 return <Dialog title="Paramètres de l’application" onClose={onClose}><h2>Membres</h2><p>Les membres partagent les personnes, comptes, entreprises et documents de cet espace.</p>{members.map(m=><p key={m.id}>{m.displayName} · {m.role}</p>)}{admin&&<button onClick={()=>void createInvitation("member",undefined,s.id).then(inv=>setInvite(location.origin+import.meta.env.BASE_URL+"?invite="+encodeURIComponent(inv.token))).catch(e=>setError(errorText(e)))}>Créer une invitation</button>}{invite&&<label>Lien d’invitation<input readOnly value={invite} onFocus={e=>e.target.select()}/></label>}
 {admin&&users.some(u=>u.active&&!members.some(m=>m.id===u.id))&&<div><label>Utilisateur existant<select value={existing} onChange={e=>setExisting(e.target.value)}><option value="">Choisir…</option>{users.filter(u=>u.active&&!members.some(m=>m.id===u.id)).map(u=><option key={u.id} value={u.id}>{u.displayName}</option>)}</select></label><button disabled={!existing} onClick={()=>void liveRequest("post","members",{userId:existing}).then(()=>liveRequest<typeof members>("get","members")).then(setMembers).catch(e=>setError(errorText(e)))}>Ajouter à l’espace</button></div>}
 <h2>Apparence</h2><button onClick={toggleTheme}>Changer le thème</button>
 {admin&&<><h2>Sauvegardes</h2><p>{backup?.enabled?"Dernière sauvegarde : "+(backup.lastSuccess??"jamais"):"Configurez BACKUP_PATH pour activer les sauvegardes."}</p>{backup?.error&&<p>{backup.error}</p>}<button disabled={!backup?.enabled} onClick={()=>void api.post("backups").then(r=>setBackup(r.data)).catch(e=>setError(errorText(e)))}>Sauvegarder maintenant</button></>}{error&&<p role="alert">{error}</p>}<footer><button onClick={onClose}>Fermer</button></footer></Dialog>;
}
