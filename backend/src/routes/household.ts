import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { listUsers } from "../services/authService.js";
import { loadCompanies, saveCompanies } from "../services/companiesService.js";
import { extractTextLocally } from "../services/localOcrService.js";
import { getWorkspaceRoot, resolveSafe } from "../services/fileSystem.js";
import { workspaceContext } from "../services/workspaceContext.js";
import { loadHousehold, mutateHousehold, fail, makeTransaction, editTransaction, validateAccount, validateAllocations, matchTransfer, transferSuggestions, previewImport, commitImport, summarize, exportHousehold, validDate } from "../services/householdService.js";
import type { HouseholdAccount, HouseholdTransaction, HouseholdImport, HouseholdBudget, HouseholdRecurring } from "../types/household.js";

interface Command {
  revision: number; action: string; id?: string; expectedRevision?: number;
  account?: HouseholdAccount; transaction?: Partial<HouseholdTransaction>;
  changes?: { id:string; revision:number; patch:Partial<HouseholdTransaction> }[];
  fromId?:string; toId?:string; budget?:HouseholdBudget; recurring?:HouseholdRecurring;
}
export async function householdRoutes(app: FastifyInstance) {
  await app.register(multipart,{limits:{fileSize:20*1024*1024,files:1}});
  app.addHook("preHandler",async (_req,reply)=>{
    if(workspaceContext.getStore()?.kind!=="household")return reply.code(403).send({error:"Espace foyer requis."});
  });
  app.get("/",async()=>loadHousehold());
  app.get("/members",async()=>{
    const context=workspaceContext.getStore()!;
    const workspace=loadCompanies().find(c=>c.id===context.id)!;
    return listUsers().filter(u=>["owner","admin"].includes(context.role)||workspace.memberIds?.includes(u.id)).map(u=>({id:u.id,displayName:u.displayName,role:u.role,member:workspace.memberIds?.includes(u.id)??true}));
  });
  app.post<{Body:{userId:string}}>("/members",async(req,reply)=>{
    const context=workspaceContext.getStore()!;
    if(!["owner","admin"].includes(context.role))return reply.code(403).send({error:"Administrateur requis."});
    if(!listUsers().some(u=>u.id===req.body?.userId&&u.active))fail("Utilisateur actif requis.");
    const list=loadCompanies();const workspace=list.find(c=>c.id===context.id)!;
    workspace.memberIds=[...new Set([...(workspace.memberIds??[]),req.body.userId])];saveCompanies(list);return {ok:true};
  });
  app.post<{Params:{id:string}}>("/receipts/:id/analyze",async req=>{
    const state=await loadHousehold();
    const receipt=state.transactions.filter(t=>!t.deleted).flatMap(t=>t.attachments).find(a=>a.id===req.params.id);
    if(!receipt)fail("Justificatif introuvable.",404);
    if(!process.env.OCR_LOCAL_URL)fail("OCR local non configuré. Le justificatif reste disponible.",503);
    return {text:await extractTextLocally(await fs.readFile(resolveSafe("attachments/"+receipt.id)),receipt.mime)};
  });
  app.get<{Querystring:{contextId?:string;accountId?:string;from?:string;to?:string}}>("/summary",async req=>summarize(await loadHousehold(),req.query));
  app.get("/transfer-suggestions",async()=>transferSuggestions(await loadHousehold()));
  app.post<{Body:Command}>("/commands",async req=>{
    const input=req.body;
    if(!input || typeof input.action!=="string")fail("Commande requise.");
    return mutateHousehold(input.revision,input.action,state=>{
      switch(input.action){
        case "account": {
          const value=input.account;if(!value)fail("Compte requis.");validateAccount(state,value);
          const existing=value.id?state.accounts.find(a=>a.id===value.id):undefined;
          if(value.id&&!existing)fail("Compte introuvable.",404);
          const record={...value,id:existing?.id??randomUUID()};
          const before=existing?structuredClone(existing):undefined;
          if(existing)Object.assign(existing,record);else state.accounts.push(record);
          return {recordId:record.id,before,after:record};
        }
        case "transaction": {
          if(!input.transaction)fail("Transaction requise.");
          if(input.id)return editTransaction(state,input.id,input.transaction,input.expectedRevision!);
          const record=makeTransaction(state,input.transaction);state.transactions.push(record);
          return {recordId:record.id,after:record};
        }
        case "delete": return editTransaction(state,input.id!,{deleted:true},input.expectedRevision!);
        case "bulk": {
          if(!Array.isArray(input.changes)||!input.changes.length||input.changes.length>500)fail("Sélection invalide.");
          const changes=input.changes.map(change=>editTransaction(state,change.id,change.patch,change.revision));
          return {after:changes};
        }
        case "transfer": return matchTransfer(state,input.fromId!,input.toId);
        case "unlink": {
          const record=state.transfers.find(t=>t.id===input.id);if(!record)fail("Virement introuvable.",404);
          state.transfers=state.transfers.filter(t=>t.id!==input.id);return {recordId:input.id,before:record};
        }
        case "budget": {
          const value=input.budget;
          if(!value||!state.contexts.some(c=>c.id===value.contextId)||!value.category?.trim()||!Number.isSafeInteger(value.cents)||value.cents<0)fail("Budget invalide.");
          const existing=state.budgets.find(b=>b.id===value.id);
          if(value.id&&!existing)fail("Budget introuvable.",404);
          const before=existing?structuredClone(existing):undefined;const record={...value,id:existing?.id??randomUUID()};
          if(existing)Object.assign(existing,record);else state.budgets.push(record);
          return {recordId:record.id,before,after:record};
        }
        case "recurring": {
          const value=input.recurring;
          if(!value||!value.label?.trim()||!state.accounts.some(a=>a.id===value.accountId)||!Number.isSafeInteger(value.cents)||value.cents<=0||!validDate(value.nextDate)||!["monthly","quarterly","yearly"].includes(value.frequency))fail("Échéance invalide.");
          validateAllocations(state,value.allocations,-value.cents);
          const existing=state.recurring.find(r=>r.id===value.id);
          if(value.id&&!existing)fail("Échéance introuvable.",404);
          const before=existing?structuredClone(existing):undefined;const record={...value,id:existing?.id??randomUUID()};
          if(existing)Object.assign(existing,record);else state.recurring.push(record);
          return {recordId:record.id,before,after:record};
        }
        case "delete-budget": {state.budgets=state.budgets.filter(b=>b.id!==input.id);return {recordId:input.id};}
        default: fail("Commande inconnue.");
      }
    });
  });
  app.post<{Body:HouseholdImport}>("/imports/preview",{bodyLimit:12*1024*1024},async req=>previewImport(await loadHousehold(),req.body));
  app.post<{Body:HouseholdImport & {revision:number}}>("/imports/commit",{bodyLimit:12*1024*1024},async req=>mutateHousehold(req.body.revision,"import",state=>commitImport(state,req.body)));
  app.get<{Querystring:{mode?:string;contextId?:string;accountId?:string;from?:string;to?:string}}>("/export",async(req,reply)=>{
    if(req.query.mode && !["transactions","allocations"].includes(req.query.mode))fail("Export inconnu.");
    return reply.header("Content-Type","text/csv; charset=utf-8").header("Content-Disposition",'attachment; filename="foyer-'+(req.query.mode??"transactions")+'.csv"').send(exportHousehold(await loadHousehold(),req.query.mode??"transactions",req.query.contextId,req.query.accountId,req.query.from,req.query.to));
  });
  app.post<{Params:{id:string};Querystring:{revision:string;transactionRevision:string}}>("/transactions/:id/receipts",async req=>{
    const file=await req.file();if(!file)fail("Fichier requis.");
    const extensions:Record<string,string>={"application/pdf":".pdf","image/jpeg":".jpg","image/png":".png","image/webp":".webp"};
    const extension=extensions[file.mimetype];if(!extension)fail("PDF, JPEG, PNG ou WebP requis.");
    const buffer=await file.toBuffer();
    const signatures:Record<string,boolean>={"application/pdf":buffer.subarray(0,5).toString()==="%PDF-","image/jpeg":buffer[0]===255&&buffer[1]===216,"image/png":buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),"image/webp":buffer.subarray(0,4).toString()==="RIFF"&&buffer.subarray(8,12).toString()==="WEBP"};
    if(!signatures[file.mimetype])fail("Le contenu ne correspond pas au format annoncé.");
    const receipt={id:randomUUID()+extension,name:path.basename(file.filename),mime:file.mimetype};
    const root=getWorkspaceRoot();await fs.mkdir(path.join(root,"attachments"),{recursive:true});
    const target=path.join(root,"attachments",receipt.id);
    await fs.writeFile(target,buffer,{flag:"wx",mode:0o600});
    try{return await mutateHousehold(Number(req.query.revision),"receipt",state=>{
      const transaction=state.transactions.find(t=>t.id===req.params.id&&!t.deleted);
      if(!transaction)fail("Transaction introuvable.",404);
      if(transaction.revision!==Number(req.query.transactionRevision))fail("Transaction modifiée. Rechargez.",409);
      transaction.attachments.push(receipt);transaction.revision++;transaction.updatedAt=new Date().toISOString();transaction.updatedBy=workspaceContext.getStore()!.actor;
      return {recordId:transaction.id,after:receipt};
    });}catch(error){await fs.unlink(target).catch(()=>undefined);throw error;}
  });
  app.get<{Params:{id:string}}>("/receipts/:id",async(req,reply)=>{
    const state=await loadHousehold();
    const receipt=state.transactions.filter(t=>!t.deleted).flatMap(t=>t.attachments).find(a=>a.id===req.params.id);
    if(!receipt)fail("Justificatif introuvable.",404);
    return reply.header("Content-Type",receipt.mime).header("X-Content-Type-Options","nosniff").header("Content-Disposition","inline").send(await fs.readFile(resolveSafe("attachments/"+receipt.id)));
  });
}
