import {createContext,useContext,useState,type Dispatch,type SetStateAction} from "react";
import {useAppStore} from "../../stores/appStore";
import {parseTab} from "./model";
export const LiveTabContext=createContext<string|null>(null);
/** Update only this tab's UI context; the tool and financial scope remain immutable. */
export function useTabState<T>(key:string,initial:T):[T,Dispatch<SetStateAction<T>>]{
 const id=useContext(LiveTabContext);const [value,setValue]=useState<T>(()=>{
  const spec=parseTab(useAppStore.getState().tabs.find(t=>t.id===id)?.path);
  return (spec.ui?.[key] as T|undefined)??initial;
 });
 const update:Dispatch<SetStateAction<T>>=next=>{
  const resolved=typeof next==="function"?(next as (previous:T)=>T)(value):next;setValue(resolved);
  if(id)useAppStore.setState(state=>({tabs:state.tabs.map(t=>{if(t.id!==id)return t;const spec=parseTab(t.path);return {...t,path:JSON.stringify({...spec,...(key==="period"?{period:resolved}:{}),ui:{...spec.ui,[key]:resolved}})};})}));
 };
 return [value,update];
}
