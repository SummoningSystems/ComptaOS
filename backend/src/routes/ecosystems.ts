import {spreadsheetsRoutes} from "./spreadsheets.js";
import {documentBytes} from "../services/ecosystemDocuments.js";
import Papa from "papaparse";
import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import fs from "node:fs/promises";
import path from "node:path";
import { createEcosystem, listEcosystems, loadEcosystem, ecosystemCommand, ecosystemRoot, mutateEcosystem, previewEcosystemImport, requireAdmin, uid } from "../services/ecosystemService.js";
import { fail } from "../services/householdService.js";
import { atomicWriteFile } from "../services/atomicFile.js";
import { listUsers } from "../services/authService.js";
import { loadCompanies, saveCompanies } from "../services/companiesService.js";
import { actorContext, workspaceLock, workspaceContext } from "../services/workspaceContext.js";
import { extractTextLocally } from "../services/localOcrService.js";
import type { HouseholdImport } from "../types/household.js";
import { ecosystemBankingRoutes } from "./ecosystemBanking.js";
type Params={id:string;documentId:string};
export async function ecosystemsRoutes(app:FastifyInstance){
  await app.register(multipart,{limits:{fileSize:20*1024*1024,files:1}});
  app.get("/",async()=>listEcosystems());
  app.post<{Body:{name:string}}>("/",async(req,reply)=>reply.code(201).send(await createEcosystem(req.body?.name)));
  app.get<{Params:Params}>("/:id",async req=>loadEcosystem(req.params.id));
  app.post<{Params:Params;Body:Record<string,unknown>}>("/:id/commands",{bodyLimit:12*1024*1024},async req=>ecosystemCommand(req.params.id,req.body??{}));
  app.post<{Params:Params;Body:{content:string}}>("/:id/imports/columns",{bodyLimit:12*1024*1024},async req=>{ecosystemRoot(req.params.id);return {columns:Papa.parse(req.body.content,{header:true,preview:1}).meta.fields??[]};});
  app.post<{Params:Params;Body:HouseholdImport}>("/:id/imports/preview",{bodyLimit:12*1024*1024},async req=>previewEcosystemImport(await loadEcosystem(req.params.id),req.body));
  app.get<{Params:Params}>("/:id/members",async req=>{ecosystemRoot(req.params.id);const ids=loadCompanies().find(c=>c.id===req.params.id)!.memberIds!;return listUsers().filter(u=>ids.includes(u.id)).map(u=>({id:u.id,displayName:u.displayName,role:u.role}));});
  app.post<{Params:Params;Body:{userId:string}}>("/:id/members",async req=>{requireAdmin();const root=ecosystemRoot(req.params.id);if(!listUsers().some(u=>u.id===req.body?.userId&&u.active))fail("Utilisateur actif requis.");await workspaceLock(root,async()=>{const records=loadCompanies(),record=records.find(c=>c.id===req.params.id)!;record.memberIds=[...new Set([...(record.memberIds??[]),req.body.userId])];saveCompanies(records);});return {ok:true};});
  app.get<{Params:Params}>("/:id/preferences",async req=>{
    const root=ecosystemRoot(req.params.id),user=actorContext.getStore()?.id??"local";
    return JSON.parse(await fs.readFile(path.join(root,"preferences",user+".json"),"utf8").catch(e=>{if(e.code!=="ENOENT")throw e;return "{}";}));
  });
  app.put<{Params:Params;Body:unknown}>("/:id/preferences",{bodyLimit:256*1024},async req=>{
    const root=ecosystemRoot(req.params.id),user=actorContext.getStore()?.id??"local";
    await atomicWriteFile(path.join(root,"preferences",user+".json"),JSON.stringify(req.body));return {ok:true};
  });
  app.post<{Params:Params;Querystring:{revision:string;scope?:string;movement?:string;kind?:string}}>("/:id/documents",async req=>{
    const root=ecosystemRoot(req.params.id),file=await req.file();if(!file)fail("Fichier requis.");
    const types:Record<string,string>={"application/pdf":"pdf","image/jpeg":"jpg","image/png":"png","image/webp":"webp"};
    const ext=types[file.mimetype];if(!ext)fail("PDF, JPEG, PNG ou WebP requis.");const buffer=await file.toBuffer();
    const valid=file.mimetype==="application/pdf"?buffer.subarray(0,5).toString()==="%PDF-":file.mimetype==="image/jpeg"?buffer[0]===255&&buffer[1]===216:file.mimetype==="image/png"?buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):buffer.subarray(0,4).toString()==="RIFF"&&buffer.subarray(8,12).toString()==="WEBP";
    if(!valid)fail("Le contenu ne correspond pas au format annoncé.");
    const id=uid()+"."+ext,target=path.join(root,"documents",id);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,buffer,{flag:"wx",mode:0o600});
    try{return await mutateEcosystem(req.params.id,Number(req.query.revision),"document-upload",s=>{
      const links=req.query.scope&&req.query.scope!=="root"?[req.query.scope]:[],movementIds=req.query.movement?[req.query.movement]:[];
      if(links.some(id=>!s.entities.some(e=>e.id===id))||movementIds.some(id=>!s.movements.some(m=>m.id===id)))fail("Liens invalides.");
      const doc={id,name:path.basename(file.filename),fileName:path.basename(file.filename),mime:file.mimetype,kind:req.query.kind??"receipt",date:new Date().toISOString().slice(0,10),links,movementIds};s.documents.push(doc);return doc;
    });}catch(e){
      // Keep the blob if its metadata has reached the durable recovery journal.
      const durable=await fs.readFile(path.join(root,"ecosystem.pending.json"),"utf8").catch(()=>"");
      const committed=await fs.readFile(path.join(root,"ecosystem.json"),"utf8").catch(()=>"");
      if(!durable.includes(id)&&!committed.includes(id))await fs.unlink(target).catch(()=>undefined);throw e;
    }
  });
  app.get<{Params:Params}>("/:id/documents/:documentId/file",async(req,reply)=>{
    const s=await loadEcosystem(req.params.id),doc=s.documents.find(d=>d.id===req.params.documentId);if(!doc)fail("Document introuvable.",404);
    return reply.header("Content-Type",doc.mime).header("X-Content-Type-Options","nosniff").header("Content-Disposition","inline").send(await documentBytes(s,doc));
  });
  app.post<{Params:Params}>("/:id/documents/:documentId/analyze",async req=>{
    const s=await loadEcosystem(req.params.id),doc=s.documents.find(d=>d.id===req.params.documentId);if(!doc)fail("Document introuvable.",404);
    if(!process.env.OCR_LOCAL_URL)fail("OCR local non configuré. Le document reste disponible.",503);
    return {text:await extractTextLocally(await documentBytes(s,doc),doc.mime)};
  });
  await app.register(async scoped=>{
    scoped.addHook("preHandler",(req,_reply,done)=>{
      const {ecosystemId:id,scope}=req.params as {ecosystemId:string;scope:string};
      void loadEcosystem(id).then(s=>{
        if(scope!=="root"&&!s.entities.some(e=>e.id===scope&&e.kind!=="company"))fail("Périmètre de tableur introuvable.",404);
        const actor=actorContext.getStore()??{id:"local",role:"owner"};
        workspaceContext.run({id:s.id,root:path.join(ecosystemRoot(id),"scope-data",scope),kind:"ecosystem",actor:actor.id,role:actor.role},done);
      }).catch(done);
    });
    await spreadsheetsRoutes(scoped,{variables:async()=>({})});
  },{prefix:"/:ecosystemId/tableaux/:scope"});
  await app.register(ecosystemBankingRoutes);
}
