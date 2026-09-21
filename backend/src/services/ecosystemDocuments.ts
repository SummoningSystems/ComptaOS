import fs from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import type {Ecosystem,Document} from "../types/ecosystem.js";
import type {OutgoingInvoice,Quote} from "../types/index.js";
import {loadCompanies,resolveCompanyPath} from "./companiesService.js";
import {actorContext,workspaceContext} from "./workspaceContext.js";
import {fail} from "./householdService.js";
async function json<T>(file:string,fallback:T):Promise<T>{try{return JSON.parse(await fs.readFile(file,"utf8"));}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return fallback;throw e;}}
export async function hydrateDocuments(s:Ecosystem){
 const found:Document[]=[];
 for(const entity of s.entities.filter(e=>e.workspaceId)){
  const company=loadCompanies().find(c=>c.id===entity.workspaceId&&c.ecosystemId===s.id);if(!company)continue;const root=resolveCompanyPath(company);
  const add=(kind:"attachment"|"invoice"|"quote",id:string,name:string,date:string,mime:string,movementIds:string[]=[])=>{
    const docId="native-"+createHash("sha256").update(company.id+":"+kind+":"+id).digest("hex");const old=s.documents.find(d=>d.id===docId);
    found.push({...old,id:docId,name:old?.name??name,fileName:name,mime,kind:old?.kind??(kind==="attachment"?"receipt":kind),date,links:old?.links??[entity.id],movementIds:[...new Set([...(old?.movementIds??[]),...movementIds])],resource:{workspaceId:company.id,kind,id}});
  };
  for(const inv of await json<OutgoingInvoice[]>(path.join(root,"settings","invoices.json"),[]))add("invoice",inv.id,"Facture "+inv.number+".pdf",inv.date,"application/pdf");
  for(const quote of await json<Quote[]>(path.join(root,"settings","quotes.json"),[]))add("quote",quote.id,"Devis "+quote.number+".pdf",quote.date,"application/pdf");
  const inbox=await json<{filename:string;originalName:string;mimetype:string;createdAt:string}[]>(path.join(root,"receipt-inbox.json"),[]);
  const files=await fs.readdir(path.join(root,"attachments"),{withFileTypes:true}).catch(e=>{if(e.code!=="ENOENT")throw e;return [];});
  for(const file of files){if(!file.isFile()||file.isSymbolicLink())continue;const receipt=inbox.find(r=>r.filename===file.name);const ext=path.extname(file.name).toLowerCase();const mime=receipt?.mimetype??({".pdf":"application/pdf",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp",".gif":"image/gif"} as Record<string,string>)[ext];if(!mime)continue;
    const movementIds=s.treatments.filter(t=>t.companyId===entity.id&&t.movementId&&(t.transaction.attachment===file.name||t.transaction.attachments?.includes(file.name))).map(t=>t.movementId!);
    add("attachment",file.name,receipt?.originalName??file.name,receipt?.createdAt.slice(0,10)??"",mime,movementIds);
  }
 }
 s.documents=[...s.documents.filter(d=>!d.resource),...found];
}
export async function documentBytes(s:Ecosystem,doc:Document):Promise<Buffer>{
 const registry=loadCompanies();const parent=registry.find(c=>c.id===s.id);if(!parent)fail("Écosystème introuvable.",404);
 if(!doc.resource)return fs.readFile(path.join(resolveCompanyPath(parent),"documents",path.basename(doc.id)));
 const source=doc.resource,company=registry.find(c=>c.id===source.workspaceId&&c.ecosystemId===s.id);if(!company)fail("Document inaccessible.",403);const root=resolveCompanyPath(company);
 if(source.kind==="attachment")return fs.readFile(path.join(root,"attachments",path.basename(source.id)));
 const actor=actorContext.getStore()??{id:"local",role:"owner"};
 return workspaceContext.run({id:company.id,root,kind:"business",actor:actor.id,role:actor.role},async()=>{
  const {generateInvoicePdf}=await import("../routes/invoices.js");
  if(source.kind==="invoice"){const inv=(await json<OutgoingInvoice[]>(path.join(root,"settings","invoices.json"),[])).find(i=>i.id===source.id);if(!inv)fail("Facture introuvable.",404);return Buffer.from(await generateInvoicePdf(inv));}
  const q=(await json<Quote[]>(path.join(root,"settings","quotes.json"),[])).find(i=>i.id===source.id);if(!q)fail("Devis introuvable.",404);return Buffer.from(await generateInvoicePdf({...q,status:"draft",dueDate:""},"DEVIS"));
 });
}
