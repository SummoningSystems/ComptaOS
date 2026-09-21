import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import axios from "axios";
import { api } from "../../api/client";
import type { HouseholdState } from "../../types/household";
export const euros = (cents: number) => (cents/100).toLocaleString("fr-FR",{style:"currency",currency:"EUR"});
export const amount = (value: string) => Math.round(Number(value.replace(",", "."))*100);
export function errorMessage(error: unknown) { return axios.isAxiosError(error) ? error.response?.data?.message ?? error.response?.data?.error ?? error.message : String(error); }
export const load = async () => (await api.get<HouseholdState>("/household")).data;
export type Command = (values: Record<string, unknown>, revision?: number) => Promise<void>;
export function Field({label,children}:{label:string;children:ReactNode}) { const id=useId(); return <div className="hh-field"><label htmlFor={id}>{label}</label>{isValidElement(children)?cloneElement(children as ReactElement<{id?:string}>,{id}):children}</div>; }
export function Modal({title,children,onClose}:{title:string;children:ReactNode;onClose:()=>void}) { return <div className="hh-overlay"><section role="dialog" aria-modal="true" aria-label={title} className="hh-modal"><header><h2>{title}</h2><button onClick={onClose} aria-label="Fermer">×</button></header>{children}</section></div>; }
export function splitPercent(cents:number,percentages:number[]) {
  return percentages.map((percent,index)=>index===percentages.length-1?cents-percentages.slice(0,-1).reduce((sum,p)=>sum+Math.round(cents*p/100),0):Math.round(cents*percent/100));
}
