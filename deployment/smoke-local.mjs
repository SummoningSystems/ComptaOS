import https from "node:https";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const ca=await fs.readFile(process.env.COMPTAOS_CA ?? "/tmp/comptaos-ca.crt");
let cookie="";
async function request(route,method="GET",body) {
  return new Promise((resolve,reject)=>{
    const data=body===undefined?undefined:JSON.stringify(body);
    const req=https.request("https://localhost"+route,{method,ca,headers:{...(cookie?{Cookie:cookie}:{}),...(data?{"Content-Type":"application/json","Content-Length":Buffer.byteLength(data)}:{})}},res=>{
      const chunks=[];res.on("data",chunk=>chunks.push(chunk));res.on("end",()=>{
        const raw=Buffer.concat(chunks).toString();let result;try{result=JSON.parse(raw);}catch{result=raw;}
        resolve({status:res.statusCode,body:result,cookies:res.headers["set-cookie"]??[]});
      });
    });
    req.on("error",reject);if(data)req.write(data);req.end();
  });
}
let available=false;
for(let i=0;i<30;i++){try{const r=await request("/api/health");if(r.status===200){available=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,1000));}
assert(available,"HTTPS health check failed");
const credentials={username:"container-test",displayName:"Container test",password:"temporary-container-test-123"};
const status=await request("/api/auth/status");
if(status.body.needsSetup){assert.equal((await request("/api/auth/setup","POST",credentials)).status,201);}
const login=await request("/api/auth/login","POST",credentials);assert.equal(login.status,200);
assert(login.cookies.some(value=>value.includes("Secure")&&value.includes("HttpOnly")));
cookie=login.cookies[0].split(";")[0];
let spaces=await request("/api/ecosystems");
if(!spaces.body.length){
  const created=await request("/api/ecosystems","POST",{name:"Container ecosystem"});
  assert.equal(created.status,201);assert.equal(created.body.entities.length,0);
  const saved=await request("/api/ecosystems/"+created.body.id+"/commands","POST",{revision:0,action:"entity",entity:{id:"alice",kind:"person",name:"Alice"}});
  assert.equal(saved.status,200);spaces=await request("/api/ecosystems");
}
const endpoint="/api/ecosystems/"+spaces.body[0].id;
const state=await request(endpoint);assert.equal(state.status,200);assert.equal(state.body.entities[0].name,"Alice");
const backup=await request("/api/backups","POST",{});assert.equal(backup.status,200);assert(backup.body.lastSuccess);
cookie="";assert.equal((await request(endpoint)).status,401);
console.log("HTTPS, secure login, persisted ecosystem and backup smoke checks passed.");
