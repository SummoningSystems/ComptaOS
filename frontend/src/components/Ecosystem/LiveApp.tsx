import {CopilotPanel} from "../Copilot/CopilotPanel";
import {LiveTabContext} from "./tabContext";
import {LiveTasks} from "./LiveTasks";
import {LiveReconcile} from "./LiveReconcile";
import {LiveReports} from "./LiveReports";
import {LivePlugins} from "./LivePlugins";
import {LiveSearch} from "./LiveSearch";
import {FileTree} from "../Explorer/FileTree";
import {LiveBusinessIndex} from "./LiveBusinessIndex";
import {LiveVariables} from "./LiveVariables";
import {resolveTool,switchToolScope,tools} from "./toolCatalog";
import {useEffect,useMemo,useState,useRef,lazy,Suspense} from "react";
import {useTheme} from "../../hooks/useTheme";
import {api,buildApiUrl} from "../../api/client";
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
const SpreadsheetView=lazy(()=>import("../Spreadsheet/SpreadsheetView").then(m=>({default:m.SpreadsheetView})));
type LegacyMigrationPreview={available:boolean;candidates:{id:string;name:string;transactions:number;activeTransactions:number;rejectedTransactions:number;attachments:number;bankAccounts:number}[];totals:{transactions:number;activeTransactions:number;rejectedTransactions:number;attachments:number;bankAccounts:number};bankProfileReusable:boolean;notes:string[]};
export default function LiveApp({user,onLogout}:{user:AuthUser|null;onLogout:()=>Promise<void>}){
 const [list,setList]=useState<{id:string;name:string}[]|null>(null),[chosen,setChosen]=useState(""),[name,setName]=useState("Mon écosystème"),[error,setError]=useState("");const data=useLive(s=>s.data);
 const preference="comptaos_ecosystem_"+(user?.id??"local");
 useEffect(()=>{let active=true;useLive.setState({data:null,error:""});api.get<{id:string;name:string}[]>("ecosystems").then(({data})=>{if(!active)return;setList(data);const wanted=new URLSearchParams(location.search).get("ecosystem")??localStorage.getItem(preference);setChosen(data.find(e=>e.id===wanted)?.id??data[0]?.id??"");}).catch(e=>setError(errorText(e)));return()=>{active=false;};},[preference]);
 useEffect(()=>{if(!chosen)return;let active=true;useLive.getState().load(chosen).then(()=>{if(active){bindLiveStructure();localStorage.setItem(preference,chosen);}}).catch(e=>setError(errorText(e)));return()=>{active=false;};},[chosen,preference]);
 if(chosen&&data?.id===chosen)return <LiveShell key={chosen} user={user} onLogout={onLogout}/>;
 return <main className="eco-app eco-work"><h1>Votre écosystème financier</h1><p>Créez votre espace commun, puis ajoutez les personnes, entreprises et comptes dans Structure.</p>{error&&<p role="alert">{error}</p>}{list===null?<p>Chargement…</p>:list.length?<p>Ouverture de l’espace…</p>:(!user||["owner","admin"].includes(user.role))?<form className="eco-settings-form" onSubmit={async e=>{e.preventDefault();try{const {data}=await api.post<Ecosystem>("ecosystems",{name});useLive.getState().accept(data);bindLiveStructure();setChosen(data.id);}catch(e){setError(errorText(e));}}}><label>Nom de l’espace<input required value={name} onChange={e=>setName(e.target.value)}/></label><button className="eco-primary">Créer l’écosystème</button></form>:<p>Demandez une invitation à l’administrateur de votre espace.</p>}<button onClick={()=>void onLogout()}>Déconnexion</button></main>;
}
function LivePanel({spec,user,tabId}:{spec:ScopeTab;user:AuthUser|null;tabId:string}){
 const s=useLive(x=>x.data)!;const entity=s.entities.find(e=>e.id===spec.scope);const tool=resolveTool(spec);
 if((tool==="reports"||tool==="export")&&!entity?.workspaceId)return <LiveReports spec={spec}/>;
 if(tool==="assistant"&&entity?.workspaceId)return <WorkspaceApiProvider id={entity.workspaceId}><CopilotPanel open onClose={()=>useAppStore.getState().closeTab(tabId)}/></WorkspaceApiProvider>;
 if(tool==="reconcile")return <LiveReconcile spec={spec}/>;
 if(tool==="variables")return <LiveVariables spec={spec}/>;
 if(spec.view==="structure")return <Structure scope={spec.scope}/>;
 if(spec.view==="documents")return <LiveDocuments spec={spec}/>;
 if(spec.view==="settings")return <ScopeSettings spec={spec} live/>;
 if(spec.view==="transactions")return <LiveMovements spec={spec}/>;
 if(spec.view==="movement")return <LiveMovement spec={spec}/>;
 if(spec.view==="accounting")return <LiveTreatment key={spec.record} spec={spec}/>;
 if(spec.view==="flows"&&!entity?.workspaceId)return <LiveOverview spec={spec}/>;
 if(tool==="import")return <LiveImport spec={spec}/>;
 if(tool==="banking")return <LiveBanking/>;
 if(tool==="budgets"||tool==="recurring"&&!entity?.workspaceId)return <LivePlanning spec={spec}/>;
 if(tool==="transfers")return <LiveTransfers spec={spec}/>;
 if(tool==="audit")return <div className="eco-work"><h1>Historique partagé</h1>{[...s.history].filter(h=>spec.scope===ROOT||h.scopeIds?.includes(spec.scope)).reverse().map((h,i)=><details key={i}><summary>{h.at} · {h.actor} · {h.action}</summary><pre style={{whiteSpace:"pre-wrap"}}>{JSON.stringify(h.details,null,2)}</pre></details>)}</div>;
 if(tool==="review"||tool==="alerts")return <LiveTasks spec={spec}/>;
 const type=spec.businessType??(tool==="overview"&&entity?.workspaceId?"dashboard":undefined)??(tool?(tools[tool] as {businessType?:TabType}).businessType:undefined);
 if(type==="spreadsheets"&&!entity?.workspaceId)return <Suspense fallback={<p>Chargement du tableur…</p>}><SpreadsheetView apiBase={buildApiUrl(import.meta.env.BASE_URL,`ecosystems/${s.id}/tableaux/${spec.scope}`)}/></Suspense>;
 if(tool==="files"||tool==="editor")return <WorkspaceApiProvider id={entity?.workspaceId??""} resourcePrefix={entity?.workspaceId?undefined:`ecosystems/${s.id}/filespaces/${spec.scope}`}><WorkspaceStoreProvider scope={spec.scope}>{tool==="files"?<FileTree/>:<ViewContent tabId={tabId} type="editor" path={spec.businessPath} currentUser={user}/>}</WorkspaceStoreProvider></WorkspaceApiProvider>;
 if(type&&!entity?.workspaceId&&type!=="spreadsheets")return <LiveBusinessIndex spec={spec} type={type}/>;
 if(entity?.workspaceId&&type)return <WorkspaceApiProvider id={entity.workspaceId}><WorkspaceStoreProvider scope={entity.id}><ViewContent tabId={tabId} type={type} path={spec.businessPath} currentUser={user}/></WorkspaceStoreProvider></WorkspaceApiProvider>;
 if(!tool)return <div className="eco-work"><h1>Outil indisponible</h1><p>Ce lien ne correspond pas à un outil connu. L’onglet est conservé.</p></div>;
 return <LiveOverview spec={spec}/>;
}
function LiveShell({user,onLogout}:{user:AuthUser|null;onLogout:()=>Promise<void>}){
 const callbackJob=useRef<Promise<void>|null>(null);
 const {toggle}=useTheme();const {data:s,error,busy}=useLive();const ecosystemId=s!.id;const {entities,relations}=useEcosystem();const {tabs,activeTabId}=useAppStore();const [notice,setNotice]=useState("");const [section,setSection]=useState<SidebarSection>("ecosystem"),[application,setApplication]=useState(false),[search,setSearch]=useState<string|null>(null);
 const spec=useMemo(()=>parseTab(tabs.find(t=>t.id===activeTabId)?.path),[tabs,activeTabId]);
 const groups=useMemo(()=>{const groups=scopeNavigation(spec.scope,entities,relations);const m=groups.find(g=>g.id==="movements");if(m?.items)for(const label of ["Virements","Connexions bancaires"])m.items.push({label,icon:"⇄",tab:{id:label,title:label,type:"ecosystem",path:JSON.stringify({view:"placeholder",scope:spec.scope,label,section:"movements"})}});const company=entities.find(e=>e.id===spec.scope&&e.kind==="company");if(company){const d=groups.find(g=>g.id==="documents");if(d?.items)for(const label of ["Facturation","Créer des devis","Modèles","Tiers","RH","Profil et comptabilité","Écritures et catégorisation","Alertes","Historique Git"])d.items.push({label,icon:"▤",tab:{id:label,title:label,type:"ecosystem",path:JSON.stringify({view:"placeholder",scope:spec.scope,label,section:"documents"})}});}return groups;},[spec.scope,entities,relations]);
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
 function switchScope(scope:string){const next=switchToolScope(spec,scope,entities.find(e=>e.id===scope));setNotice(next.notice??"");openScope(next.spec);}
 const tree=<div className="eco-sidebar-content"><button onClick={()=>openScope({view:"placeholder",scope:ROOT,label:"Vue d’ensemble"})}>◈ Vue d’ensemble</button><button onClick={()=>openScope({view:"structure",scope:ROOT})}>◇ Structure</button><button onClick={()=>openScope({view:"flows",scope:ROOT})}>⇄ Tous les flux</button>{(["person","company","account"] as const).map(kind=><details open key={kind}><summary>{kinds[kind]}</summary>{entities.filter(e=>e.kind===kind&&!e.archived).map(e=><button key={e.id} onClick={()=>switchScope(e.id)}>{e.name}</button>)}</details>)}</div>;
 return <div className="eco-app flex flex-col h-screen bg-vscode-bg text-vscode-text"><header className="eco-titlebar"><strong>ComptaOS</strong><select aria-label="Périmètre actif" value={spec.scope} onChange={e=>switchScope(e.target.value)}><option value={ROOT}>Vue d’ensemble</option>{(["person","company","account"] as const).map(kind=><optgroup key={kind} label={kinds[kind]}>{entities.filter(e=>e.kind===kind&&!e.archived).map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</optgroup>)}</select><span className="flex-1"/><button onClick={()=>setSearch("")}>Rechercher</button><button onClick={()=>setApplication(true)}>Application</button><span>{user?.displayName}</span><button onClick={()=>void onLogout()}>Déconnexion</button></header>
 <LegacyMigration ecosystemId={ecosystemId}/>
 {notice&&<div role="status">{notice}<button onClick={()=>setNotice("")}>Fermer</button></div>}
 {error&&<div role="alert" className="eco-error">{error} <button onClick={()=>void useLive.getState().load(ecosystemId).then(()=>useLive.setState({error:""})).catch(()=>undefined)}>Recharger</button></div>}
 <WorkspaceLayout sidebar={<Sidebar activeSection={section} onSectionChange={setSection} ecosystem={tree} groups={groups} scopeLabel={scopeName(spec.scope)} onOpenTab={tab=>openScope(tab.type==="dashboard"?{view:"placeholder",scope:spec.scope,toolId:"overview",label:"Dashboard"}:parseTab(tab.path))} explorerContent={tree}/>}><div className="eco-panels flex-1 min-h-0">{tabs.filter(t=>t.type==="ecosystem").map(t=><div key={t.id} role="tabpanel" aria-label={t.title} hidden={t.id!==activeTabId} className="eco-panel"><LiveTabContext.Provider value={t.id}><LivePanel spec={parseTab(t.path)} user={user} tabId={t.id}/></LiveTabContext.Provider></div>)}</div></WorkspaceLayout>
 <footer className="eco-live-status"><span>{s!.name} · {busy?"Enregistrement…":"Enregistré sur le serveur"} · révision {s!.revision}</span><span>{user?.role==="readonly"?"Lecture seule":"Espace partagé"}</span></footer>
 {search!==null&&<LiveSearch scope={spec.scope} onClose={()=>setSearch(null)}/>}
 {application&&<ApplicationSettings toggleTheme={toggle} user={user} onClose={()=>setApplication(false)}/>}</div>;
}
function LegacyMigration({ecosystemId}:{ecosystemId:string}){
 const [preview,setPreview]=useState<LegacyMigrationPreview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[done,setDone]=useState("");
 useEffect(()=>{let active=true;void liveRequest<LegacyMigrationPreview>("get","legacy-migration").then(value=>{if(active)setPreview(value);}).catch(e=>{if(active)setError(errorText(e));});return()=>{active=false;};},[ecosystemId]);
 if(!preview?.available&&!error&&!done)return null;
 const run=async()=>{
  if(!confirm(`Migrer ${preview!.totals.transactions} transactions historiques et ${preview!.totals.attachments} justificatifs dans cet écosystème ?\n\nLes dossiers d’origine seront conservés et une sauvegarde de l’état actuel sera créée.`))return;
  setBusy(true);setError("");
  try{
   const result=await liveRequest<{state:Ecosystem;report:LegacyMigrationPreview&{bankProfileMigrated:boolean}}>("post","legacy-migration",{revision:useLive.getState().data!.revision});
   useLive.getState().accept(result.state);bindLiveStructure();setPreview(null);
   setDone(result.report.bankProfileMigrated?"Migration terminée. La connexion PSD2 existante a été reprise ; vérifiez les comptes puis lancez une synchronisation.":"Migration terminée. Les données sont reprises ; reconnectez la banque dans Connexions bancaires pour réactiver la synchronisation PSD2.");
  }catch(e){setError(errorText(e));}finally{setBusy(false);}
 };
 return <section className="eco-migration" aria-label="Migration des données historiques">
  {preview?.available&&<><div><strong>Données historiques détectées</strong><span>{preview.candidates.map(c=>c.name).join(", ")} · {preview.totals.activeTransactions} opérations actives · {preview.totals.rejectedTransactions} rejetées · {preview.totals.attachments} justificatifs · {preview.totals.bankAccounts} comptes bancaires</span><small>{preview.bankProfileReusable?"Le profil PSD2 existant sera réutilisé.":"Les données bancaires seront reprises, mais une reconnexion Powens pourra être nécessaire."}</small></div><button className="eco-primary" disabled={busy} onClick={()=>void run()}>{busy?"Migration en cours…":"Migrer toutes mes données"}</button></>}
  {done&&<span role="status">{done}</span>}{error&&<span role="alert">{error}</span>}
 </section>;
}
function ApplicationSettings({user,onClose,toggleTheme}:{user:AuthUser|null;onClose:()=>void;toggleTheme:()=>void}){
 const s=useLive(x=>x.data)!;const [users,setUsers]=useState<AuthUser[]>([]),[existing,setExisting]=useState("");const [members,setMembers]=useState<{id:string;displayName:string;role:string}[]>([]),[invite,setInvite]=useState(""),[error,setError]=useState(""),[backup,setBackup]=useState<{enabled:boolean;lastSuccess?:string;error?:string}|null>(null);
 const [module,setModule]=useState<"users"|"pricing"|"plugins"|null>(null);
 const admin=!user||["owner","admin"].includes(user.role);
 useEffect(()=>{void liveRequest<typeof members>("get","members").then(setMembers).catch(e=>setError(errorText(e)));if(admin)void fetchUsers().then(setUsers).catch(e=>setError(errorText(e)));if(admin)void api.get("backups").then(r=>setBackup(r.data)).catch(e=>setError(errorText(e)));},[admin]);
 if(module)return <Dialog title={module==="users"?"Utilisateurs et rôles":module==="plugins"?"Extensions":"Plans et licence"} onClose={()=>setModule(null)}>{module==="plugins"?<LivePlugins/>:<ViewContent type={module} currentUser={user}/>}</Dialog>;
 return <Dialog title="Paramètres de l’application" onClose={onClose}><h2>Membres</h2><p>Les membres partagent les personnes, comptes, entreprises et documents de cet espace.</p>{members.map(m=><p key={m.id}>{m.displayName} · {m.role}</p>)}{admin&&<button onClick={()=>void createInvitation("member",undefined,s.id).then(inv=>setInvite(location.origin+import.meta.env.BASE_URL+"?invite="+encodeURIComponent(inv.token))).catch(e=>setError(errorText(e)))}>Créer une invitation</button>}{invite&&<label>Lien d’invitation<input readOnly value={invite} onFocus={e=>e.target.select()}/></label>}
 {admin&&users.some(u=>u.active&&!members.some(m=>m.id===u.id))&&<div><label>Utilisateur existant<select value={existing} onChange={e=>setExisting(e.target.value)}><option value="">Choisir…</option>{users.filter(u=>u.active&&!members.some(m=>m.id===u.id)).map(u=><option key={u.id} value={u.id}>{u.displayName}</option>)}</select></label><button disabled={!existing} onClick={()=>void liveRequest("post","members",{userId:existing}).then(()=>liveRequest<typeof members>("get","members")).then(setMembers).catch(e=>setError(errorText(e)))}>Ajouter à l’espace</button></div>}
 {admin&&<button onClick={()=>setModule("users")}>Gérer les utilisateurs et rôles</button>}<button onClick={()=>setModule("pricing")}>Plans et licence</button>{admin&&<button onClick={()=>setModule("plugins")}>Extensions</button>}<h2>Apparence</h2><button onClick={toggleTheme}>Changer le thème</button>
 {admin&&<><h2>Sauvegardes</h2><p>{backup?.enabled?"Dernière sauvegarde : "+(backup.lastSuccess??"jamais"):"Configurez BACKUP_PATH pour activer les sauvegardes."}</p>{backup?.error&&<p>{backup.error}</p>}<button disabled={!backup?.enabled} onClick={()=>void api.post("backups").then(r=>setBackup(r.data)).catch(e=>setError(errorText(e)))}>Sauvegarder maintenant</button></>}{error&&<p role="alert">{error}</p>}<footer><button onClick={onClose}>Fermer</button></footer></Dialog>;
}
