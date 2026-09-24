import {createContext,useContext,useMemo,type ReactNode} from 'react';
import * as legacy from './client';
import {createWorkspaceApi} from './client';
export const WorkspaceApiContext=createContext<ReturnType<typeof createWorkspaceApi>>(legacy);
export function WorkspaceApiProvider({id,children,resourcePrefix}:{id:string;children:ReactNode;resourcePrefix?:string}) {const client=useMemo(()=>createWorkspaceApi(id,resourcePrefix),[id,resourcePrefix]);return <WorkspaceApiContext.Provider value={client}>{children}</WorkspaceApiContext.Provider>;}
export const useWorkspaceApi=()=>useContext(WorkspaceApiContext);
