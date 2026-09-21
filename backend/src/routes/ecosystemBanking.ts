import type { FastifyInstance } from "fastify";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { getConfig, saveConfig, isConfiguredViaEnv } from "../services/bankingService.js";
import { ecosystemRoot, loadEcosystem, mutateEcosystem, requireAdmin, uid, makeMovement } from "../services/ecosystemService.js";
import { atomicWriteFile } from "../services/atomicFile.js";
import { actorContext, workspaceLock } from "../services/workspaceContext.js";
import { fail, validDate } from "../services/householdService.js";
type Params={id:string;feedId:string};
interface Profile {token:string;configKey:string;state?:string;expires?:number}
interface ProviderAccount {id:number;id_connection:number;name:string;iban?:string;balance:number;currency?:{id:string};deleted?:string;disabled?:boolean}
interface ProviderMovement {id:number;id_account:number;date:string;value:number|null;wording?:string;original_wording?:string;coming?:boolean;deleted?:string;active?:boolean}
async function profiles(id:string):Promise<Record<string,Profile>>{return JSON.parse(await fs.readFile(path.join(ecosystemRoot(id),".powens_profiles.json"),"utf8").catch(e=>{if(e.code!=="ENOENT")throw e;return "{}";}));}
async function saveProfiles(id:string,value:Record<string,Profile>){await atomicWriteFile(path.join(ecosystemRoot(id),".powens_profiles.json"),JSON.stringify(value));}
const owner=()=>actorContext.getStore()?.id??"local";
async function config(){const c=await getConfig();if(!c)fail("Powens non configuré.",400);return c;}
async function request<T>(id:string,ownerId:string,endpoint:string,options:RequestInit={}):Promise<T>{
  const c=await config(),p=(await profiles(id))[ownerId];if(!p)fail("Connectez votre banque avant de synchroniser.");
  const key=createHash("sha256").update(c.domain+c.clientId+c.clientSecret).digest("hex");if(key!==p.configKey)fail("Configuration Powens modifiée. Reconnectez la banque.",409);
  const base=`https://${c.domain}.biapi.pro`,url=new URL(endpoint,base+"/2.0/");
  if(url.origin!==base||!url.pathname.startsWith("/2.0/"))fail("Lien de pagination bancaire invalide.",502);
  const response=await fetch(url,{...options,signal:AbortSignal.timeout(30000),headers:{"Authorization":"Bearer "+p.token,"Content-Type":"application/json"}});
  if(!response.ok)fail("Powens : requête refusée ("+response.status+"). Vérifiez la connexion.",502);
  return await response.json() as T;
}
async function accounts(id:string,ownerId:string){return (await request<{accounts:ProviderAccount[]}>(id,ownerId,"users/me/accounts")).accounts.filter(a=>!a.deleted&&!a.disabled);}
export async function ecosystemBankingRoutes(app:FastifyInstance){
  app.get<{Params:Params}>("/:id/banking",async req=>{ecosystemRoot(req.params.id);const c=await getConfig();return {configured:!!c,domain:c?.domain,hosted:isConfiguredViaEnv(),connected:!!(await profiles(req.params.id))[owner()]};});
  app.post<{Params:Params;Body:{domain:string;clientId:string;clientSecret:string}}>("/:id/banking/config",async req=>{requireAdmin();ecosystemRoot(req.params.id);if(isConfiguredViaEnv())fail("Configuration gérée par l’environnement.",403);await saveConfig(req.body);return {ok:true};});
  app.post<{Params:Params;Body:{redirectUrl:string}}>("/:id/banking/connect",async req=>{
    const id=req.params.id,root=ecosystemRoot(id),c=await config();
    const redirect=new URL(req.body.redirectUrl);const expected=process.env.COMPTAOS_PUBLIC_URL?new URL(process.env.COMPTAOS_PUBLIC_URL).origin:req.headers.origin;
    if(!["https:","http:"].includes(redirect.protocol)||!expected||redirect.origin!==expected||redirect.search||redirect.hash||redirect.username||redirect.password)fail("URL de retour invalide. Utilisez l’adresse de cette installation sans paramètres.");
    return workspaceLock(root+"-banking",async()=>{
      const all=await profiles(id),key=createHash("sha256").update(c.domain+c.clientId+c.clientSecret).digest("hex");let p=all[owner()];
      if(!p||p.configKey!==key){const response=await fetch(`https://${c.domain}.biapi.pro/2.0/auth/init`,{method:"POST",signal:AbortSignal.timeout(30000),headers:{"Content-Type":"application/json"},body:JSON.stringify({client_id:c.clientId,client_secret:c.clientSecret})});if(!response.ok)fail("Création du profil bancaire refusée.",502);const value=await response.json() as {auth_token:string};if(!value.auth_token)fail("Réponse bancaire invalide.",502);p={token:value.auth_token,configKey:key};}
      p.state=uid();p.expires=Date.now()+15*60*1000;all[owner()]=p;await saveProfiles(id,all);
      const {code}=await request<{code:string}>(id,owner(),"auth/token/code");
      const query=new URLSearchParams({domain:c.domain,client_id:c.clientId,redirect_uri:redirect.href,code,state:p.state});return {url:"https://webview.powens.com/connect?"+query};
    });
  });
  app.post<{Params:Params;Body:{state:string}}>("/:id/banking/callback",async req=>{const root=ecosystemRoot(req.params.id);return workspaceLock(root+"-banking",async()=>{const all=await profiles(req.params.id),p=all[owner()];if(!p||p.state!==req.body.state||!p.expires||p.expires<Date.now())fail("Retour bancaire expiré ou invalide.",400);delete p.state;delete p.expires;await saveProfiles(req.params.id,all);return {ok:true};});});
  app.post<{Params:Params}>("/:id/banking/discover",async req=>({accounts:await accounts(req.params.id,owner())}));
  app.post<{Params:Params;Body:{revision:number;providerAccountId:number;accountId:string}}>("/:id/banking/map",async req=>{
    const a=(await accounts(req.params.id,owner())).find(a=>a.id===req.body.providerAccountId);if(!a||a.currency?.id!=="EUR")fail("Compte bancaire EUR requis.");
    return mutateEcosystem(req.params.id,req.body.revision,"bank-map",s=>{
      if(!s.entities.some(e=>e.id===req.body.accountId&&e.kind==="account"&&!e.archived))fail("Compte local actif requis.");
      const account=s.entities.find(e=>e.id===req.body.accountId)!;const iban=a.iban?.replace(/\s/g,"").toUpperCase();
      if(iban&&s.entities.some(e=>e.id!==account.id&&e.bankIdentifier===iban))fail("Ce compte bancaire existe déjà dans la structure. Associez son compte existant.",409);
      if(account.bankIdentifier&&iban&&account.bankIdentifier!==iban)fail("L’identifiant bancaire ne correspond pas au compte choisi.");
      if(iban){account.bankIdentifier=iban;account.revision=(account.revision??0)+1;}
      if(s.feeds.some(f=>f.accountId===req.body.accountId||f.ownerId===owner()&&f.providerAccountId===a.id))fail("Un flux est déjà associé à ce compte.",409);
      const f={id:uid(),ownerId:owner(),connectionId:a.id_connection,providerAccountId:a.id,accountId:req.body.accountId,name:a.name,balance:Math.round(a.balance*100),balanceAt:new Date().toISOString()};s.feeds.push(f);return f;
    });
  });
  app.delete<{Params:Params}>("/:id/banking/feeds/:feedId",async req=>mutateEcosystem(req.params.id,undefined,"bank-unlink",s=>{const feed=s.feeds.find(f=>f.id===req.params.feedId);if(feed&&feed.ownerId!==owner())requireAdmin();s.feeds=s.feeds.filter(f=>f.id!==req.params.feedId);return req.params.feedId;}));
  app.post<{Params:Params}>("/:id/banking/feeds/:feedId/sync",async req=>{
    const id=req.params.id,feed=(await loadEcosystem(id)).feeds.find(f=>f.id===req.params.feedId);if(!feed)fail("Flux introuvable.",404);
    return workspaceLock(ecosystemRoot(id)+"-feed-"+feed.id,async()=>{
      try{
        const rows:ProviderMovement[]=[];let next:string|undefined=`users/me/accounts/${feed.providerAccountId}/transactions?limit=1000&all`;const visited=new Set<string>();
        while(next){if(visited.has(next)||visited.size>1000)fail("Pagination bancaire invalide.",502);visited.add(next);const data: {transactions:ProviderMovement[];_links?:{next?:{href:string}|string}}=await request(id,feed.ownerId,next);rows.push(...data.transactions);const link=data._links?.next;next=typeof link==="string"?link:link?.href;}
        const a=(await accounts(id,feed.ownerId)).find(a=>a.id===feed.providerAccountId);
        return await mutateEcosystem(id,undefined,"bank-sync",s=>{
          const current=s.feeds.find(f=>f.id===feed.id);if(!current)fail("Flux déconnecté pendant la synchronisation.",409);
          let imported=0,updated=0;
          for(const raw of rows){
            if(raw.id_account!==undefined&&raw.id_account!==feed.providerAccountId)fail("Compte bancaire inattendu.",502);
            if(!Number.isFinite(raw.value)||!validDate(raw.date))continue;
            const key=feed.ownerId+":"+feed.providerAccountId+":"+raw.id,cents=Math.round(raw.value!*100),label=raw.wording||raw.original_wording||"Mouvement bancaire";
            const old=s.movements.find(m=>m.sources?.some(source=>source.provider==="powens"&&source.key===key))??s.movements.find(m=>m.source?.provider==="powens"&&m.source.key===key);
            if(old){
              if(old.date!==raw.date||old.cents!==cents||!!raw.deleted&&!old.deleted){old.sourceChange={date:raw.date,cents,label,deleted:!!raw.deleted,pending:raw.coming===true};old.reviewed=false;old.revision++;updated++;}
              if(old.pending&&!raw.coming&&!raw.deleted&&old.date===raw.date&&old.cents===cents){old.pending=false;old.revision++;}
              continue;
            }
            if(raw.deleted||raw.active===false)continue;
            const m=makeMovement(s,{accountId:feed.accountId,date:raw.date,cents,label});m.source={provider:"powens",key,raw};m.pending=raw.coming===true;
            // Cross-source matches remain reviewable instead of discarding equal purchases.
            const possible=s.movements.filter(x=>x.accountId===m.accountId&&x.date===m.date&&x.cents===m.cents&&!x.deleted&&x.source?.provider!=="powens");
            if(possible.length){m.duplicateCandidates=possible.map(x=>x.id);m.notes="Doublon possible : comparez avec les relevés déjà importés.";}
            s.movements.push(m);imported++;
          }
          current.lastSync=new Date().toISOString();delete current.error;if(a){current.balance=Math.round(a.balance*100);current.balanceAt=current.lastSync;}return {feedId:feed.id,imported,updated};
        });
      }catch(error){await mutateEcosystem(id,undefined,"bank-error",s=>{const f=s.feeds.find(f=>f.id===feed.id);if(f)f.error=error instanceof Error?error.message:"Synchronisation impossible";return {feedId:feed.id};});throw error;}
    });
  });
}
