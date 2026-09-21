import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { createGzip, createGunzip } from "node:zlib";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import { createInterface } from "node:readline";
import { getCompaniesRoot } from "./companiesService.js";
import { exclusiveSnapshot } from "./maintenance.js";
import { atomicWriteFile } from "./atomicFile.js";
import { drainWorkspaceWrites } from "./workspaceContext.js";

export interface BackupStatus { enabled:boolean; lastSuccess?:string; file?:string; error?:string }
const statusFile=()=>path.join(getCompaniesRoot(),"_backup-status.json");
export async function backupStatus():Promise<BackupStatus> {
  const saved=await fs.readFile(statusFile(),"utf8").then(s=>JSON.parse(s)).catch(error=>{if(error.code!=="ENOENT")throw error;return {};});
  return {...saved,enabled:!!process.env.BACKUP_PATH};
}
async function* files(root:string,prefix=""):AsyncGenerator<string> {
  for(const entry of await fs.readdir(path.join(root,prefix),{withFileTypes:true})){
    if(entry.isSymbolicLink()||entry.name.endsWith(".tmp"))continue;
    const relative=prefix?prefix+"/"+entry.name:entry.name;
    if(entry.isDirectory())yield* files(root,relative);
    else if(entry.isFile())yield relative;
  }
}
function outside(root:string,target:string) {const relative=path.relative(root,target);return relative===".."||relative.startsWith(".."+path.sep)||path.isAbsolute(relative);}
export async function createBackup():Promise<BackupStatus> {
  if(!process.env.BACKUP_PATH)throw Object.assign(new Error("BACKUP_PATH non configuré."),{statusCode:400});
  const root=getCompaniesRoot(),destination=path.resolve(process.env.BACKUP_PATH);
  if(!outside(root,destination))throw new Error("Les sauvegardes doivent être hors du dossier de données.");
  return exclusiveSnapshot(async()=>{
    await drainWorkspaceWrites();
    await fs.mkdir(destination,{recursive:true,mode:0o700});
    const name="comptaos-"+new Date().toISOString().replace(/[:.]/g,"-")+"-"+randomUUID()+".jsonl.gz";
    const target=path.join(destination,name),temporary=target+".tmp";
    const output=createWriteStream(temporary,{flags:"wx",mode:0o600});
    const gzip=createGzip();gzip.pipe(output);
    const completion=finished(output);
    // Observe stream failures immediately, even while the directory is being read.
    let streamError:Error|undefined;
    output.on("error",error=>{streamError=error;gzip.destroy(error);});
    gzip.on("error",error=>{streamError=error;output.destroy(error);});
    void completion.catch(()=>undefined);
    const write=async(value:unknown)=>{if(streamError)throw streamError;if(!gzip.write(JSON.stringify(value)+"\n"))await once(gzip,"drain");};
    try{
      await write({format:"ComptaOS-backup",version:1,at:new Date().toISOString()});
      let count=0;
      for await(const relative of files(root)){
        const buffer=await fs.readFile(path.join(root,relative));
        await write({path:relative,sha256:createHash("sha256").update(buffer).digest("hex"),data:buffer.toString("base64")});count++;
      }
      await write({complete:true,count});gzip.end();await completion;
      await fs.rename(temporary,target);
      const result={enabled:true,lastSuccess:new Date().toISOString(),file:name};
      await atomicWriteFile(statusFile(),JSON.stringify(result));
      for(const file of await fs.readdir(destination)){
        if(!/^comptaos-.*\.jsonl\.gz$/.test(file))continue;
        const candidate=path.join(destination,file);
        if((await fs.stat(candidate)).mtimeMs<Date.now()-14*86400000)await fs.unlink(candidate);
      }
      return result;
    }catch(error){gzip.destroy();output.destroy();await completion.catch(()=>undefined);await fs.unlink(temporary).catch(()=>undefined);await atomicWriteFile(statusFile(),JSON.stringify({...await backupStatus(),error:error instanceof Error?error.message:String(error)}));throw error;}
  });
}
/** Offline restore into an empty destination; validate everything before exposing the restored data. */
export async function restoreBackup(archive:string,target:string) {
  const resolved=path.resolve(target);
  const entries=await fs.readdir(resolved).catch(error=>{if(error.code!=="ENOENT")throw error;return [];});
  if(entries.length)throw new Error("La destination de restauration doit être vide.");
  const staging=resolved+".restore-"+randomUUID();await fs.mkdir(staging,{recursive:true,mode:0o700});
  const source=createReadStream(archive);const unzip=createGunzip();source.pipe(unzip);
  source.on("error",error=>unzip.destroy(error));
  const lines=createInterface({input:unzip,crlfDelay:Infinity});
  let count=0,header=false,complete=false;const seen=new Set<string>();
  try{
    for await(const line of lines){
      const record=JSON.parse(line);
      if(!header){if(record.format!=="ComptaOS-backup"||record.version!==1)throw new Error("Archive incompatible.");header=true;continue;}
      if(complete)throw new Error("Données après la fin de l’archive.");
      if(record.complete){if(record.count!==count)throw new Error("Archive incomplète.");complete=true;continue;}
      if(typeof record.path!=="string"||!record.path||record.path.includes("\\")||record.path.includes(":")||record.path.split("/").some((part:string)=>!part||part==="."||part==="..")||path.isAbsolute(record.path)||seen.has(record.path))throw new Error("Chemin d’archive invalide.");
      const destination=path.resolve(staging,record.path);if(outside(staging,destination))throw new Error("Chemin hors destination.");
      const buffer=Buffer.from(record.data,"base64");
      if(createHash("sha256").update(buffer).digest("hex")!==record.sha256)throw new Error("Somme de contrôle invalide.");
      await fs.mkdir(path.dirname(destination),{recursive:true,mode:0o700});await fs.writeFile(destination,buffer,{flag:"wx",mode:0o600});seen.add(record.path);count++;
    }
    if(!complete)throw new Error("Archive interrompue.");
    // Recheck the destination before its final replacement.
    if((await fs.readdir(resolved).catch(error=>{if(error.code!=="ENOENT")throw error;return [];})).length)throw new Error("La destination a changé.");
    await fs.rmdir(resolved).catch(error=>{if(error.code!=="ENOENT")throw error;});
    await fs.rename(staging,resolved);
  }catch(error){source.destroy();unzip.destroy();await fs.rm(staging,{recursive:true,force:true});throw error;}
}
export function startBackupScheduler() {
  if(!process.env.BACKUP_PATH)return;
  const check=async()=>{const status=await backupStatus();if(!status.lastSuccess||Date.now()-Date.parse(status.lastSuccess)>=86400000)await createBackup();};
  const timer=setInterval(()=>void check().catch(error=>console.error("[backup]",error.message)),60*60*1000);
  timer.unref();void check().catch(error=>console.error("[backup]",error.message));
}
