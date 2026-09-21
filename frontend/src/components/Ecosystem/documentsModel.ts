import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ROOT, movements, type Entity, type Relation } from "./model";

export const documentTypes={receipt:"Justificatif",statement:"Relevé bancaire",contract:"Contrat",invoice:"Facture",quote:"Devis"};
export type DocumentKind=keyof typeof documentTypes;
export type EcoDocument={id:string;name:string;kind:DocumentKind;date:string;links:string[];movementId?:string;fileName?:string};
const examples:EcoDocument[]=[
  {id:"doc-mixed",name:"Matériel · achat mixte",kind:"receipt",date:"2026-09-12",links:["studio","perso-a"],movementId:"m6"},
  {id:"doc-personal",name:"Assurance personnelle · Augustin",kind:"contract",date:"2026-09-01",links:["augustin"]},
  {id:"doc-statement",name:"Relevé septembre · Pro Augustin",kind:"statement",date:"2026-09-30",links:["pro-a"]},
  {id:"doc-rent",name:"Bail · résidence",kind:"contract",date:"2026-08-01",links:["joint-fixe"]},
  {id:"doc-invoice",name:"Mission design · facture client",kind:"invoice",date:"2026-09-03",links:["studio"],movementId:"m1"},
  {id:"doc-partner",name:"Atelier · devis client",kind:"quote",date:"2026-09-08",links:["atelier"]},
  {id:"doc-groceries",name:"Courses · ticket",kind:"receipt",date:"2026-09-14",links:[],movementId:"m7"},
];
export const useDocuments=create<{documents:EcoDocument[];save:(doc:EcoDocument)=>void;reset:()=>void}>()(persist(set=>({
  documents:structuredClone(examples),
  save:doc=>set(s=>({documents:s.documents.some(d=>d.id===doc.id)?s.documents.map(d=>d.id===doc.id?doc:d):[doc,...s.documents]})),
  reset:()=>set({documents:structuredClone(examples)}),
}),{name:"comptaos-ecosystem-documents-v1",partialize:s=>({documents:s.documents})}));

export type DocumentMatch={kind:"direct"|"associated";reasons:string[]};
export function matchDocument(doc:EcoDocument,scope:string,entities:Entity[],relations:Relation[]):DocumentMatch|null {
  const name=(id:string)=>entities.find(e=>e.id===id)?.name??id;
  if(scope===ROOT)return {kind:"direct",reasons:["Bibliothèque de l’ensemble de l’écosystème"]};
  if(doc.links.includes(scope))return {kind:"direct",reasons:["Lien direct · "+name(scope)]};
  const entity=entities.find(e=>e.id===scope);if(!entity)return null;
  const related=new Map<string,string>();
  if(entity.kind==="person"){
    for(const r of relations.filter(r=>r.from===scope&&(r.kind==="holder"||r.kind==="activity")))
      related.set(r.to,(r.kind==="holder"?"Compte détenu · ":"Activité · ")+name(r.to));
  }
  if(entity.kind==="company"){
    for(const r of relations){
      if(r.kind==="usage"&&r.to===scope)related.set(r.from,"Compte utilisé · "+name(r.from));
      if(r.kind==="holder"&&r.from===scope)related.set(r.to,"Compte détenu · "+name(r.to));
    }
    const queue=[scope],visited=new Set([scope]);
    while(queue.length){
      const id=queue.shift()!;
      for(const r of relations.filter(r=>r.kind==="subsidiary"&&r.from===id)){
        if(visited.has(r.to))continue;visited.add(r.to);queue.push(r.to);
        related.set(r.to,"Participation · "+name(r.to));
      }
    }
  }
  const reasons=doc.links.filter(id=>related.has(id)).map(id=>related.get(id)!);
  const movement=movements.find(m=>m.id===doc.movementId);
  if(movement){
    const touches=entity.kind==="account"?(movement.from===scope||movement.to===scope)
      :entity.kind==="company"?(movement.company===scope||related.has(movement.from)||related.has(movement.to)||related.has(movement.company??""))
      :related.has(movement.from)||related.has(movement.to)||related.has(movement.company??"");
    if(touches)reasons.push("Mouvement associé · "+movement.label);
  }
  return reasons.length?{kind:"associated",reasons:[...new Set(reasons)]}:null;
}

