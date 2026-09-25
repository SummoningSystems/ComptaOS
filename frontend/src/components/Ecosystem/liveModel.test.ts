import {describe,it,expect} from "vitest";
import {totals} from "./LiveOverview";
import {documentMatch} from "./LiveDocuments";
import type {Ecosystem,Movement} from "../../types/ecosystem";
function movement(id:string,cents:number,extra:Partial<Movement>={}):Movement{return {id,accountId:"personal",date:"2026-09-01",label:id,cents,currency:"EUR",revision:1,reviewed:false,nature:cents<0?"expense":"income",notes:"",allocations:[{id:id+"-a",target:"root",category:"Courses",cents}],...extra};}
function state():Ecosystem{return {schemaVersion:1,id:"space",name:"Space",revision:0,entities:[{id:"alice",kind:"person",name:"Alice"},{id:"bob",kind:"person",name:"Bob"},{id:"studio",kind:"company",name:"Studio"},{id:"personal",kind:"account",name:"Personal"},{id:"joint",kind:"account",name:"Joint"}],relations:[{id:"a",from:"alice",to:"personal",kind:"holder"},{id:"b",from:"alice",to:"joint",kind:"holder"},{id:"c",from:"bob",to:"joint",kind:"holder"}],movements:[],transfers:[],documents:[],treatments:[],budgets:[],recurring:[],feeds:[],imports:[],history:[]};}
describe("shared financial views",()=>{
 it("counts allocations once and excludes transfers, pending rows and unresolved overlaps",()=>{
  const s=state();s.movements=[movement("purchase",-10000,{allocations:[{id:"pro",target:"studio",category:"Equipment",cents:-7000},{id:"pers",target:"alice",category:"Equipment",cents:-3000}]}),movement("debit",-80000),movement("credit",80000,{accountId:"joint"}),movement("pending",-500,{pending:true}),movement("duplicate",-10000,{duplicateCandidates:["purchase"]}),movement("refund",1000,{nature:"refund"})];s.transfers=[{id:"t",fromId:"debit",toId:"credit"}];
  expect(totals(s,"root","2026-09").expenses).toBe(9000);expect(totals(s,"studio","2026-09").expenses).toBe(7000);expect(totals(s,"alice","2026-09").expenses).toBe(3000);expect(totals(s,"root","2026-09").income).toBe(0);
 });
 it("shares one joint-account document without associating unrelated personal documents",()=>{
  const s=state(),doc={id:"d",name:"Statement",kind:"statement",date:"2026-09-01",links:["joint"],movementIds:[],fileName:"statement.pdf",mime:"application/pdf"};
  expect(documentMatch(s,doc,"alice")).not.toBeNull();expect(documentMatch(s,doc,"bob")).not.toBeNull();expect(documentMatch(s,{...doc,links:["alice"]},"bob")).toBeNull();
 });
});
