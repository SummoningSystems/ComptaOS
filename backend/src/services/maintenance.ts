import type { FastifyInstance } from "fastify";
let frozen = false;
let active = 0;
let waiters: (() => void)[] = [];
let drained: (() => void)[] = [];
export async function beginWork() {
  while (frozen) await new Promise<void>(resolve => waiters.push(resolve));
  active++;
  let released=false;
  return () => { if(released)return;released=true;active--;if(!active){for(const resolve of drained)resolve();drained=[];} };
}
export async function exclusiveSnapshot<T>(work:()=>Promise<T>):Promise<T> {
  while(frozen)await new Promise<void>(resolve=>waiters.push(resolve));
  frozen=true;
  try{if(active)await new Promise<void>(resolve=>drained.push(resolve));return await work();}
  finally{frozen=false;const pending=waiters;waiters=[];pending.forEach(resolve=>resolve());}
}
export function registerMaintenance(app:FastifyInstance) {
  const releases = new WeakMap<object,()=>void>();
  app.addHook("onRequest",async req=>{
    if(!req.url.startsWith("/api/") || /^\/api\/(backups|health)([/?]|$)/.test(req.url))return;
    releases.set(req,await beginWork());
  });
  app.addHook("onResponse",async req=>{releases.get(req)?.();releases.delete(req);});
}
