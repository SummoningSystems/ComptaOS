import {filesRoutes} from "./files.js";
import {search as searchWorkspace} from "../services/searchService.js";
import {listPlugins,setPluginEnabled,runPlugin} from "../services/pluginService.js";
import {getCompaniesRoot} from "../services/companiesService.js";
import {resolveVariables} from "../domain/ecosystemVariables.js";
import {financialTotals} from "../domain/ecosystemMetrics.js";
import {parseReceiptTextLocally} from "../services/receiptParser.js";
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
import { loadCompanies, saveCompanies,resolveCompanyPath } from "../services/companiesService.js";
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
  app.get<{Params:Params}>("/:id/variables",async req=>{const s=await loadEcosystem(req.params.id);return resolveVariables(s,s.variables??[]);});
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
    const text=await extractTextLocally(await documentBytes(s,doc),doc.mime);return {text,proposal:parseReceiptTextLocally(text)};
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
    await spreadsheetsRoutes(scoped,{variables:async req=>{
      const {ecosystemId,scope}=req.params as {ecosystemId:string;scope:string};const s=await loadEcosystem(ecosystemId);
      const totals=financialTotals(s,scope);const values:Record<string,number>={affectations_revenus_total:totals.income/100,affectations_depenses_total:totals.expenses/100,affectations_net_total:totals.net/100};
      for(const v of resolveVariables(s,s.variables??[]))if(v.value!==undefined)values[v.symbol]=v.value;
      return values;
    }});
  },{prefix:"/:ecosystemId/tableaux/:scope"});
  await app.register(async scoped=>{
    scoped.addHook("preHandler",(req,_reply,done)=>{
      const {ecosystemId,scope}=req.params as {ecosystemId:string;scope:string};
      void loadEcosystem(ecosystemId).then(async s=>{
        if(scope!=="root"&&!s.entities.some(e=>e.id===scope&&e.kind!=="company"))fail("Périmètre de fichiers introuvable.",404);
        const root=path.join(ecosystemRoot(ecosystemId),"scope-data",scope,"files");await fs.mkdir(root,{recursive:true});const actor=actorContext.getStore()??{id:"local",role:"owner"};
        workspaceContext.run({id:s.id,root,kind:"ecosystem",actor:actor.id,role:actor.role},done);
      }).catch(done);
    });
    await scoped.register(filesRoutes,{prefix:"/files"});
  },{prefix:"/:ecosystemId/filespaces/:scope"});
  app.get<{Params:Params;Querystring:{q:string;scope?:string}}>("/:id/search-files",async req=>{
    const s=await loadEcosystem(req.params.id),q=req.query.q?.trim();if(!q||q.length>200)return [];
    const scope=req.query.scope??"root";if(scope!=="root"&&!s.entities.some(e=>e.id===scope))fail("Périmètre invalide.");
    const actor=actorContext.getStore()??{id:"local",role:"owner"};const result:{scope:string;path:string;name:string;excerpt?:string}[]=[];
    for(const entity of [{id:"root",kind:"ecosystem",workspaceId:undefined},...s.entities]){
      if(scope!=="root"&&entity.id!==scope)continue;
      const company=entity.workspaceId?loadCompanies().find(c=>c.id===entity.workspaceId):undefined;
      const root=company?resolveCompanyPath(company):path.join(ecosystemRoot(s.id),"scope-data",entity.id,"files");
      const hits=await workspaceContext.run({id:company?.id??s.id,root,kind:company?"business":"ecosystem",actor:actor.id,role:actor.role},()=>searchWorkspace(q,100));
      result.push(...hits.filter(h=>h.type==="file").map(h=>({scope:entity.id,path:h.filePath!,name:h.fileName!,excerpt:h.excerpt})));
      if(result.length>=100)break;
    }
    return result.slice(0,100);
  });
  function installedPlugins<T>(s:Awaited<ReturnType<typeof loadEcosystem>>,installation:string,work:()=>T):T{
   const actor=actorContext.getStore()??{id:"local",role:"owner"};const entity=s.entities.find(e=>e.id===installation&&e.kind==="company");
   const company=loadCompanies().find(c=>c.id===entity?.workspaceId);if(installation!=="root"&&!company)fail("Installation introuvable.");
   return workspaceContext.run({id:company?.id??"application",root:company?resolveCompanyPath(company):getCompaniesRoot(),kind:"business",actor:actor.id,role:actor.role},work);
  }
  app.get<{Params:Params}>("/:id/plugins",async req=>{const s=await loadEcosystem(req.params.id);return ["root",...s.entities.filter(e=>e.kind==="company"&&e.workspaceId).map(e=>e.id)].flatMap(installation=>installedPlugins(s,installation,()=>listPlugins().map(p=>({...p,installation}))));});
  app.post<{Params:Params;Body:{name:string;enabled:boolean;installation?:string}}>("/:id/plugins/configure",async req=>{const s=await loadEcosystem(req.params.id);requireAdmin();if(typeof req.body.enabled!=="boolean")fail("État requis.");installedPlugins(s,req.body.installation??"root",()=>setPluginEnabled(req.body.name,req.body.enabled));return {ok:true};});
  app.post<{Params:Params;Body:{name:string;hook:string;scope:string;installation?:string}}>("/:id/plugins/run",async req=>{
   requireAdmin();const s=await loadEcosystem(req.params.id),scope=req.body.scope;
   if(scope!=="root"&&!s.entities.some(e=>e.id===scope))fail("Périmètre requis.");
   const totals=financialTotals(s,scope);
   const context={ecosystemId:s.id,scope,revision:s.revision,actor:actorContext.getStore()?.id,metrics:{income:totals.income,expenses:totals.expenses,net:totals.net,unit:"EUR cents"}};
   return {scope,result:installedPlugins(s,req.body.installation??"root",()=>runPlugin(req.body.name,req.body.hook,context))};
  });
  await app.register(ecosystemBankingRoutes);
}
