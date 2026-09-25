import {describe,it,expect} from "vitest";
import {financialTotals,treasuryAccounts,accountBalance,type MetricState} from "../domain/ecosystemMetrics.js";
import {resolveVariables,calculate,type FinancialVariable} from "../domain/ecosystemVariables.js";
const state:MetricState={entities:[{id:"alice",kind:"person"},{id:"studio",kind:"company"},{id:"joint",kind:"account",opening:{date:"2026-01-01",cents:100000}},{id:"pro",kind:"account",opening:{date:"2026-01-01",cents:50000},treasuryAssignments:[{companyId:"studio",from:"2026-09-01",to:"2026-09-30"}]}],relations:[{from:"alice",to:"joint",kind:"holder"},{from:"bob",to:"joint",kind:"holder"}],movements:[{id:"purchase",accountId:"joint",date:"2026-09-01",cents:-10000,nature:"expense",allocations:[{target:"studio",category:"equipment",cents:-7000},{target:"alice",category:"personal",cents:-3000}]},{id:"refund",accountId:"joint",date:"2026-09-02",cents:1000,nature:"refund",allocations:[{target:"alice",category:"personal",cents:1000}]},{id:"out",accountId:"joint",date:"2026-09-03",cents:-5000,nature:"expense",allocations:[{target:"common",category:"transfer",cents:-5000}]},{id:"in",accountId:"pro",date:"2026-09-03",cents:5000,nature:"income",allocations:[{target:"studio",category:"transfer",cents:5000}]}],transfers:[{fromId:"out",toId:"in"}],feeds:[]};
describe("ecosystem financial semantics",()=>{
 it("counts joint purchases once, separates personal allocations and excludes transfers",()=>{expect(financialTotals(state,"root","2026-09").expenses).toBe(9000);expect(financialTotals(state,"alice","2026-09").expenses).toBe(2000);expect(financialTotals(state,"studio","2026-09").expenses).toBe(7000);expect(financialTotals(state,"joint","2026-09").net).toBe(-9000);});
 it("dedicates cash only during the explicit date interval",()=>{expect(treasuryAccounts(state,"studio","2026-08-31")).toHaveLength(0);expect(treasuryAccounts(state,"studio","2026-09-30").map(a=>a.id)).toEqual(["pro"]);expect(treasuryAccounts(state,"studio","2026-10-01")).toHaveLength(0);expect(accountBalance(state,"joint","2026-09-30")).toBe(86000);});
 it("excludes unconfirmed sources but retains real transfers in balances",()=>{const copy=structuredClone(state);copy.movements[0].duplicateCandidates=["maybe"];expect(financialTotals(copy,"root").expenses).toBe(-1000);expect(accountBalance(copy,"joint","2026-09-30")).toBe(96000);});
 it("resolves stable variables and fails explicitly on missing references and cycles",()=>{
 const vars:FinancialVariable[]=[{id:"personal",name:"Dépenses Alice",scope:"alice",metric:"expenses",period:"2026-09"},{id:"double",name:"Double",scope:"root",metric:"net",period:"",formula:"{personal} * 2"}];
 expect(resolveVariables(state,vars)[1].value).toBe(40);vars[0].name="Renommée";expect(resolveVariables(state,vars)[1].value).toBe(40);
 vars[0].formula="{double}";expect(resolveVariables(state,vars).every(v=>v.error?.includes("circulaire"))).toBe(true);
 expect(resolveVariables(state,[{...vars[1],formula:"{missing}"}])[0].error).toContain("introuvable");
 expect(resolveVariables(state,[{...vars[1],formula:undefined,scope:"alice",metric:"balance"}])[0].value).toBeUndefined();
 });
 it("never executes arbitrary expressions",()=>{expect(calculate("(2 + 3) * 4 / 2",()=>0)).toBe(10);expect(()=>calculate("process.exit()",()=>0)).toThrow();expect(()=>calculate("1/0",()=>0)).toThrow("zéro");});
});
