import {create} from "zustand";
import {api,buildApiUrl} from "../../api/client";
import {useEcosystem} from "./model";
import type {Ecosystem} from "../../types/ecosystem";
export const errorText=(error:unknown):string=>{const e=error as {response?:{data?:{error?:string}};message?:string};return e.response?.data?.error??e.message??"Opération impossible";};
interface State {data:Ecosystem|null;error:string;busy:boolean;load:(id:string)=>Promise<void>;accept:(data:Ecosystem)=>void;command:(input:Record<string,unknown>)=>Promise<void>}
export const useLive=create<State>((set,get)=>({data:null,error:"",busy:false,
 accept:data=>{const old=get().data;if(old?.id===data.id&&old.revision>data.revision)return;set({data});useEcosystem.setState({entities:data.entities,relations:data.relations});},
 load:async id=>{try{const {data}=await api.get<Ecosystem>("ecosystems/"+id);get().accept(data);}catch(e){set({error:errorText(e)});throw e;}},
 command:async input=>{const s=get().data;if(!s)return;set({busy:true,error:""});try{const {data}=await api.post<Ecosystem>("ecosystems/"+s.id+"/commands",{revision:s.revision,...input});get().accept(data);}catch(e){set({error:errorText(e)});throw e;}finally{set({busy:false});}}
}));
export function liveUrl(path:string){const id=useLive.getState().data?.id;if(!id)throw Error("Écosystème requis");return buildApiUrl(import.meta.env.BASE_URL,"ecosystems/"+id+"/"+path);}
export async function liveRequest<T=Ecosystem>(method:"get"|"post"|"put"|"delete",path:string,body?:unknown):Promise<T>{
 const id=useLive.getState().data?.id;if(!id)throw Error("Écosystème requis");
 try{const response=await api.request<T>({method,url:"ecosystems/"+id+"/"+path,data:body});if(response.data&&typeof response.data==="object"&&"schemaVersion" in response.data)useLive.getState().accept(response.data as unknown as Ecosystem);return response.data;}catch(e){useLive.setState({error:errorText(e)});throw e;}
}
export function bindLiveStructure(){useEcosystem.setState({
 save:async entity=>{await useLive.getState().command({action:"entity",entity});},
 connect:async relation=>{await useLive.getState().command({action:"relation",relation});},
 disconnect:id=>{void useLive.getState().command({action:"disconnect",id}).catch(()=>undefined);},
 reset:()=>undefined,
});}
