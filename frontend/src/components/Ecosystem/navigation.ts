import {resolveTool} from "./toolCatalog";
import type { NavGroup, NavItem, SidebarSection } from "../Layout/Sidebar";
import { ROOT, type Entity, type Relation, type ScopeTab } from "./model";

export function accountingEnabled(entity?:Entity) {
  return entity?.kind==="company"&&(entity.accountingEnabled??["studio","atelier"].includes(entity.id));
}
export function vatEnabled(entity?:Entity) {
  return accountingEnabled(entity)&&(entity?.vatEnabled??["studio","atelier"].includes(entity?.id??""));
}
export function scopeNavigation(scope:string,entities:Entity[],relations:Relation[]):NavGroup[] {
  const entity=entities.find(e=>e.id===scope),company=entity?.kind==="company",account=entity?.kind==="account";
  const configured=accountingEnabled(entity);
  const bankAccounting=account&&relations.some(r=>(r.kind==="usage"&&r.from===scope&&accountingEnabled(entities.find(e=>e.id===r.to)))||
    (r.kind==="holder"&&r.to===scope&&accountingEnabled(entities.find(e=>e.id===r.from))));
  function item(section:SidebarSection,label:string,icon:string,view:ScopeTab["view"]="placeholder",category?:string):NavItem {
    const spec:ScopeTab={view,scope,section,...(view==="placeholder"||category?{label}:{}),...(category?{category}:{})};
    spec.toolId=resolveTool(spec);
    return {label,icon,tab:{id:section+":"+label,title:label,type:"ecosystem",path:JSON.stringify(spec)}};
  }
  const result:NavGroup[]=[
    {id:"movements",title:"Mouvements",icon:"💳",items:[
      item("movements","Transactions","📋","transactions"),
      item("movements","Importer un relevé","📥"),item("movements","Alertes","✅"),
      ...(!company||bankAccounting?[item("movements","Rapprochement","🔗")]:[]),
    ]},
  ];
  if(scope===ROOT)result.push({id:"compta",title:"Comptabilité",icon:"📒",items:[item("compta","À traiter par entreprise","✅")]});
  if(company)result.push({id:"compta",title:"Comptabilité",icon:"📒",items:configured?[
    item("compta","À traiter","✅"),item("compta","Journal","📒"),item("compta","Rapprochement","🔗"),
    item("compta","Clôture mensuelle","🗓️"),
    ...(vatEnabled(entity)?[item("compta","TVA","📊")]:[]),
  ]:[item("compta","Configurer la comptabilité","⚙️","settings")]});
  result.push({id:"documents",title:"Documents",icon:"🧾",items:[
    item("documents","Bibliothèque","▤","documents"),
    item("documents","Justificatifs","🧾","documents","receipt"),
    item("documents","Relevés bancaires","🏦","documents","statement"),
    item("documents","Contrats","📄","documents","contract"),
    ...(!account?[item("documents","Factures","🧾","documents","invoice")]:[]),
    ...(company?[item("documents","Devis","📋","documents","quote")]:[]),
    ...(!company&&!account?[item("documents","Facturation","🧾"),item("documents","Créer des devis","📋"),item("documents","Tiers","▤"),item("documents","Modèles","▤"),item("documents","RH","▤")]:[]),
  ]});
  result.push({id:"finance",title:"Finance",icon:"💰",items:[
    item("finance",account?"Solde et flux":"Trésorerie","⇄","flows"),
    ...(!account?[item("finance","Budgets","🎯"),item("finance","Frais récurrents","🔄")]:[]),
    ...(configured?[item("finance","Bilan / P&L","📈")]:[]),
  ]});
  result.push({id:"analyses",title:"Analyses & Export",icon:"📈",items:[
    item("analyses","Rapports","📊"),item("analyses","Export","⬇"),item("analyses","Tableaux","🧮"),item("analyses","Variables","𝑥"),
  ]});
  result.push({id:"outils",title:"Paramètres du périmètre",icon:"⚙️",items:[
    item("outils","Paramètres","⚙️","settings"),item("outils","Historique","🕐"),item("outils","Fichiers","📁"),...(company?[item("outils","Assistant","✨")]:[]),
  ]});
  return result;
}
export function sectionFor(spec:ScopeTab):SidebarSection {
  if(spec.section)return spec.section as SidebarSection;
  if(spec.view==="documents")return "documents";
  if(spec.view==="settings")return "outils";
  if(spec.view==="accounting")return "compta";
  if(spec.view==="transactions"||spec.view==="movement")return "movements";
  return "ecosystem";
}

