import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useAppStore } from "../../stores/appStore";

export type EntityKind = "person" | "company" | "account";
export type Entity = { revision?:number; workspaceId?:string; bankIdentifier?:string; archived?:boolean; defaultTarget?:string; opening?:{date:string;cents:number}; id: string; kind: EntityKind; name: string; usage?: string; companyType?: string; accountingEnabled?: boolean; vatEnabled?: boolean };
export type Relation = { id: string; from: string; to: string; kind: "holder" | "activity" | "usage" | "subsidiary" };
export type View = "documents" | "settings" | "structure" | "flows" | "transactions" | "movement" | "accounting" | "placeholder";
export type ScopeTab = { view: View; scope: string; record?: string; label?: string; period?: string; category?: string; section?: string; businessType?: import("../../types").TabType; businessPath?:string };
export const ROOT = "root";
// getRandomValues also works on HTTP LAN previews, unlike randomUUID.
export const prototypeId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b=>b.toString(16).padStart(2,"0")).join("");
export const kinds = { person: "Personne", company: "Entreprise", account: "Compte bancaire" };
export const symbols = { person: "◯", company: "◇", account: "▣" };
export const relationLabels = { holder: "Titulaire", activity: "Exerce dans", usage: "Utilisé pour", subsidiary: "Participation dans" };
const seedEntities: Entity[] = [
  { id: "augustin", kind: "person", name: "Augustin" },
  { id: "partenaire", kind: "person", name: "Partenaire" },
  { id: "studio", kind: "company", name: "Studio Augustin" },
  { id: "atelier", kind: "company", name: "Atelier Partenaire" },
  { id: "perso-a", kind: "account", name: "Personnel · Augustin", usage: "Courant personnel" },
  { id: "pro-a", kind: "account", name: "Pro · Augustin", usage: "Professionnel" },
  { id: "perso-b", kind: "account", name: "Personnel · Partenaire", usage: "Courant personnel" },
  { id: "pro-b", kind: "account", name: "Pro · Partenaire", usage: "Professionnel" },
  { id: "joint-fixe", kind: "account", name: "Commun · Charges", usage: "Charges fixes" },
  { id: "joint-vie", kind: "account", name: "Commun · Quotidien", usage: "Quotidien" },
];
const seedRelations: Relation[] = [
  { id: "r1", from: "augustin", to: "studio", kind: "activity" },
  { id: "r2", from: "partenaire", to: "atelier", kind: "activity" },
  ...[["augustin","perso-a"],["augustin","pro-a"],["partenaire","perso-b"],["partenaire","pro-b"],
    ["augustin","joint-fixe"],["partenaire","joint-fixe"],["augustin","joint-vie"],["partenaire","joint-vie"]]
    .map(([from,to],i): Relation => ({id:"holder-"+i,from,to,kind:"holder"})),
  { id: "r3", from: "pro-a", to: "studio", kind: "usage" },
  { id: "r4", from: "pro-b", to: "atelier", kind: "usage" },
];
interface Model {
  entities: Entity[]; relations: Relation[];
  positions: Record<string, {x:number;y:number}>;
  layout: "columns" | "free" | "hierarchy";
  setLayout: (layout: Model["layout"]) => void;
  move: (id:string, position:{x:number;y:number}) => void;
  save: (entity: Entity) => void;
  connect: (relation: Omit<Relation,"id">) => void;
  disconnect: (id: string) => void;
  reset: () => void;
}
export function validRelation(relation: Omit<Relation,"id">, entities: Entity[], relations: Relation[] = []) {
  const a=entities.find(e=>e.id===relation.from),b=entities.find(e=>e.id===relation.to);
  if(!a||!b||a.id===b.id)return false;
  if(relation.kind==="subsidiary") {
    if(a.kind!=="company"||b.kind!=="company")return false;
    const pending=[b.id], visited=new Set<string>();
    while(pending.length) {
      const current=pending.pop()!;
      if(current===a.id)return false;
      if(visited.has(current))continue;
      visited.add(current);
      pending.push(...relations.filter(r=>r.kind==="subsidiary"&&r.from===current).map(r=>r.to));
    }
    return true;
  }
  return relation.kind==="holder" ? (a.kind==="person"||a.kind==="company")&&b.kind==="account"
    : relation.kind==="activity" ? a.kind==="person"&&b.kind==="company"
    : a.kind==="account"&&b.kind==="company";
}
export const useEcosystem = create<Model>()(persist((set) => ({
  entities: structuredClone(seedEntities), relations: structuredClone(seedRelations),
  positions: {}, layout: "columns",
  setLayout: layout => set({layout}),
  move: (id,position) => set(s=>({positions:{...s.positions,[id]:position}})),
  save: entity => set(s=>({entities:s.entities.some(e=>e.id===entity.id)?s.entities.map(e=>e.id===entity.id?entity:e):[...s.entities,entity]})),
  connect: relation => set(s=>validRelation(relation,s.entities,s.relations)&&!s.relations.some(r=>r.kind===relation.kind&&r.from===relation.from&&r.to===relation.to)
    ? {relations:[...s.relations,{...relation,id:prototypeId()}]} : {}),
  disconnect: id => set(s=>({relations:s.relations.filter(r=>r.id!==id)})),
  reset: () => set({positions:{},layout:"columns",entities:structuredClone(seedEntities),relations:structuredClone(seedRelations)}),
}),{name:"comptaos-ecosystem-ux-v1",version:1,partialize:s=>new URLSearchParams(location.search).get("prototype")==="ecosystem"?({entities:s.entities,relations:s.relations,positions:s.positions,layout:s.layout}):({})}));

export function scopeName(scope:string) {
  return scope===ROOT?"Vue d’ensemble":useEcosystem.getState().entities.find(e=>e.id===scope)?.name??"Élément";
}
const titles: Record<View,string> = {documents:"Documents",settings:"Paramètres",structure:"Structure",flows:"Flux",transactions:"Mouvements",movement:"Mouvement",accounting:"Traitement",placeholder:"Aperçu"};
export function openScope(spec:ScopeTab) {
  const path=JSON.stringify(spec);
  useAppStore.getState().openTab({id:"eco:"+JSON.stringify({view:spec.view,scope:spec.scope,record:spec.record??"",businessType:spec.businessType,businessPath:spec.businessPath,category:spec.category??"",label:spec.label??titles[spec.view],period:spec.period??""}),type:"ecosystem",title:(spec.label??titles[spec.view])+" · "+scopeName(spec.scope),path});
}
export function parseTab(path?:string):ScopeTab {
  try {
    const s=JSON.parse(path??"") as ScopeTab;
    if(s && s.view in titles && typeof s.scope==="string")return s;
  } catch { /* Default to the map for invalid links. */ }
  return {view:"structure",scope:ROOT};
}
export type Movement = {id:string;date:string;from:string;to:string;label:string;cents:number;company?:string;professional?:number};
export const movements:Movement[] = [
  {id:"m1",date:"2026-09-03",from:"clients",to:"pro-a",label:"Mission design",cents:320000,company:"studio"},
  {id:"m2",date:"2026-09-05",from:"pro-a",to:"perso-a",label:"Virement vers le personnel",cents:180000},
  {id:"m3",date:"2026-09-06",from:"perso-a",to:"joint-fixe",label:"Participation aux charges",cents:80000},
  {id:"m4",date:"2026-09-06",from:"perso-b",to:"joint-fixe",label:"Participation aux charges",cents:80000},
  {id:"m5",date:"2026-09-08",from:"joint-fixe",to:"expenses",label:"Loyer",cents:120000},
  {id:"m6",date:"2026-09-12",from:"perso-a",to:"expenses",label:"Achat mixte · matériel",cents:10000,company:"studio",professional:7000},
  {id:"m7",date:"2026-09-14",from:"joint-vie",to:"expenses",label:"Courses",cents:8600},
  {id:"m8",date:"2026-08-12",from:"perso-a",to:"expenses",label:"Achat mixte · abonnement",cents:5000,company:"studio",professional:3500},
];
export const money=(cents:number)=>new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR"}).format(cents/100);
export function endpoint(id:string) {return id==="clients"?"Clients":id==="expenses"?"Dépenses externes":scopeName(id);}
export function inScope(m:Movement,scope:string,entities:Entity[],relations:Relation[]) {
  if(scope===ROOT)return true;
  const entity=entities.find(e=>e.id===scope);
  if(entity?.kind==="account")return m.from===scope||m.to===scope;
  if(entity?.kind==="company")return m.company===scope||relations.some(r=>r.kind==="usage"&&r.to===scope&&(r.from===m.from||r.from===m.to));
  return relations.some(r=>r.from===scope&&((r.kind==="holder"&&(r.to===m.from||r.to===m.to))||(r.kind==="activity"&&r.to===m.company)));
}

