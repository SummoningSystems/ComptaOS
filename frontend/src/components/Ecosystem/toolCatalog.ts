import type {ScopeTab,Entity} from "./model";
import type {TabType} from "../../types";
type Tool={label:string;businessType?:TabType;companyOnly?:boolean;section?:string};
export const tools={
 overview:{label:"Dashboard",section:"ecosystem"},structure:{label:"Structure"},flows:{label:"Flux",businessType:"treasury"},movements:{label:"Transactions"},movement:{label:"Mouvement"},treatment:{label:"Traitement"},documents:{label:"Documents"},settings:{label:"Paramètres"},
 import:{label:"Importer un relevé"},banking:{label:"Connexions bancaires"},budgets:{label:"Budgets"},recurring:{label:"Frais récurrents",businessType:"recurring"},transfers:{label:"Virements"},audit:{label:"Historique"},review:{label:"À traiter"},
 journal:{label:"Journal",businessType:"journal",companyOnly:true},closing:{label:"Clôture mensuelle",businessType:"closing",companyOnly:true},vat:{label:"TVA",businessType:"vat",companyOnly:true},profitloss:{label:"Bilan / P&L",businessType:"profitloss",companyOnly:true},
 spreadsheets:{label:"Tableaux",businessType:"spreadsheets"},invoices:{label:"Facturation",businessType:"invoices",companyOnly:true},quotes:{label:"Créer des devis",businessType:"quotes",companyOnly:true},profile:{label:"Profil et comptabilité",businessType:"settings",companyOnly:true},hr:{label:"RH",businessType:"hr",companyOnly:true},reports:{label:"Rapports",businessType:"reports"},export:{label:"Export",businessType:"export"},templates:{label:"Modèles",businessType:"templates",companyOnly:true},tiers:{label:"Tiers",businessType:"tiers",companyOnly:true},
 accountingTransactions:{label:"Écritures et catégorisation",businessType:"transactions",companyOnly:true},reconcile:{label:"Rapprochement"},alerts:{label:"Alertes"},git:{label:"Historique Git",businessType:"history",companyOnly:true},plugins:{label:"Extensions",businessType:"plugins",companyOnly:true},editor:{label:"Fichier",businessType:"editor",companyOnly:true},assistant:{label:"Assistant",companyOnly:true},files:{label:"Fichiers"},variables:{label:"Variables"}
} satisfies Record<string,Tool>;
export type ToolId=keyof typeof tools;
export function resolveTool(spec:ScopeTab):ToolId|undefined{
 if(spec.toolId&&spec.toolId in tools)return spec.toolId;
 if(spec.businessType){const match=Object.entries(tools).find(([,v])=>(v as Tool).businessType===spec.businessType);if(match)return match[0] as ToolId;}
 const views:Partial<Record<ScopeTab["view"],ToolId>>={structure:"structure",flows:"flows",transactions:"movements",movement:"movement",accounting:"treatment",documents:"documents",settings:"settings"};
 if(views[spec.view])return views[spec.view];
 if(["À traiter par entreprise","À traiter"].includes(spec.label??""))return "review";
 if(spec.label==="Vue d’ensemble")return "overview";
 return Object.entries(tools).find(([,t])=>t.label===spec.label)?.[0] as ToolId|undefined;
}
export function switchToolScope(spec:ScopeTab,scope:string,entity?:Entity):{spec:ScopeTab;notice?:string}{
 const id=resolveTool(spec),tool=id?tools[id] as Tool:undefined;
 if(!tool||["movement","treatment","editor"].includes(id!)||tool.companyOnly&&entity?.kind!=="company")return {spec:{view:"placeholder",scope,toolId:"overview",label:"Dashboard",period:spec.period},notice:"Cet outil est lié à son contexte d’origine. Son onglet reste ouvert ; voici l’aperçu du périmètre choisi."};
 return {spec:{...spec,scope,toolId:id,record:undefined,businessPath:undefined}};
}
