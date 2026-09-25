import type { Transaction } from "./index.js";
export interface Entity {
  revision?:number; id:string; kind:"person"|"company"|"account"; name:string; usage?:string; companyType?:string;
  accountingEnabled?:boolean; vatEnabled?:boolean; workspaceId?:string; archived?:boolean;
  treasuryAssignments?:{companyId:string;from:string;to?:string}[]; bankIdentifier?:string; defaultTarget?:string; opening?:{date:string;cents:number};
}
export interface Relation {id:string;from:string;to:string;kind:"holder"|"activity"|"usage"|"subsidiary"}
export interface Allocation {id:string;target:string;category:string;cents:number}
export interface Movement {
  id:string;accountId:string;date:string;label:string;cents:number;currency:"EUR";allocations:Allocation[];
  revision:number;reviewed:boolean;tags?:string[];nature:"income"|"expense"|"refund";notes:string;deleted?:boolean;pending?:boolean;
  source?:{provider:string;key:string;raw:unknown};sources?:{provider:string;key:string;raw:unknown}[];duplicateCandidates?:string[];sourceChange?:{date:string;cents:number;label:string;deleted?:boolean;pending?:boolean};
}
export interface Document {amountCents?:number;settlements?:{movementId:string;cents:number}[];id:string;name:string;kind:string;date:string;links:string[];movementIds:string[];fileName:string;mime:string;resource?:{workspaceId:string;kind:"attachment"|"invoice"|"quote";id:string}}
export interface Treatment {companyId:string;movementId?:string;allocationId?:string;transferId?:string;transaction:Transaction}
export interface Budget {id:string;target:string;category:string;cents:number;basis?:"allocations"|"accounting"}
export interface Recurring {id:string;label:string;accountId:string;cents:number;allocations:Allocation[];frequency:"monthly"|"quarterly"|"yearly";nextDate:string;active:boolean;endDate?:string;decision?:"keep"|"reduce"|"cancel"|"planned";simulatedCents?:number;notes?:string;originCompany?:string}
export interface Feed {id:string;ownerId:string;connectionId:number;providerAccountId:number;accountId:string;name:string;balance?:number;balanceAt?:string;lastSync?:string;error?:string}
export interface Ecosystem {
  schemaVersion:1|2;id:string;name:string;revision:number;entities:Entity[];relations:Relation[];movements:Movement[];
  transfers:{id:string;fromId:string;toId?:string}[];documents:Document[];treatments:Treatment[];
  budgets:Budget[];recurring:Recurring[];feeds:Feed[];imports:import("./household.js").ImportBatch[];
  planningMigrated?:string[];
  variables?:import("../domain/ecosystemVariables.js").FinancialVariable[];
  migration?:{at:string;from:number;review:string[]};
  history:{scopeIds?:string[];at:string;actor:string;action:string;details:unknown}[];
}
