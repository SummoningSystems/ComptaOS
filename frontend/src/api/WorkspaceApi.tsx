import {createContext,useContext,useMemo,type ReactNode} from 'react';
import * as legacy from './client';
import {createWorkspaceApi} from './client';
export const WorkspaceApiContext=createContext<ReturnType<typeof createWorkspaceApi>>(legacy);
export function WorkspaceApiProvider({id,children}:{id:string;children:ReactNode}) {const client=useMemo(()=>createWorkspaceApi(id),[id]);return <WorkspaceApiContext.Provider value={client}>{children}</WorkspaceApiContext.Provider>;}
export const useWorkspaceApi=()=>useContext(WorkspaceApiContext);
