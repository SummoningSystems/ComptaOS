import {createContext,useContext,useMemo,useState,type ReactNode} from "react";
import {useAppStore} from "./appStore";
import type {Tab,FileNode} from "../types";
import {openScope} from "../components/Ecosystem/model";
const Context=createContext<{scope:string;fileTree:FileNode[];setFileTree:(tree:FileNode[])=>void}|null>(null);
export function WorkspaceStoreProvider({scope,children}:{scope:string;children:ReactNode}){const [fileTree,setFileTree]=useState<FileNode[]>([]);const value=useMemo(()=>({scope,fileTree,setFileTree}),[scope,fileTree]);return <Context.Provider value={value}>{children}</Context.Provider>;}
type State=ReturnType<typeof useAppStore.getState>;
export function useWorkspaceStore<T=State>(selector?:(state:State)=>T):T {
 const state=useAppStore(),context=useContext(Context);const scope=context?.scope;
 const value=useMemo(()=>({...state,...(context?{fileTree:context.fileTree,setFileTree:context.setFileTree}:{}),openTab:(tab:Tab)=>scope?openScope({view:"placeholder",scope,label:tab.title,businessType:tab.type,businessPath:tab.path}):state.openTab(tab)}),[state,scope,context]);
 return selector?selector(value):value as T;
}
