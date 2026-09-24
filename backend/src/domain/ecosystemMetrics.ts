/** Pure domain rules shared by the server and the live UI. All amounts are cents. */
export type MetricState = {
 entities: {id:string;kind:string;opening?:{date:string;cents:number};treasuryAssignments?:{companyId:string;from:string;to?:string}[]}[];
 relations:{from:string;to:string;kind:string}[];
 movements:{id:string;accountId:string;date:string;cents:number;nature:string;deleted?:boolean;pending?:boolean;duplicateCandidates?:string[];allocations:{target:string;category:string;cents:number}[]}[];
 transfers:{fromId:string;toId?:string}[];
 treatments?:{companyId:string;transferId?:string;transaction:{date:string;amount_ht:number;amount_ttc:number;vat:number;status:string;category:string}}[];
 recurring?:{id:string;accountId:string;cents:number;allocations:{target:string;category:string;cents:number}[];frequency:string;nextDate:string;endDate?:string;active:boolean;decision?:string;simulatedCents?:number}[];
 feeds:{accountId:string;balance?:number;balanceAt?:string}[];
};
export function financialTotals(s:MetricState,scope:string,period="",category?:string){
 const account=s.entities.some(e=>e.id===scope&&e.kind==="account");
 const transfers=new Set(s.transfers.flatMap(t=>[t.fromId,t.toId]));
 let income=0,expenses=0;const categories=new Map<string,number>();
 for(const m of s.movements){
  if(m.deleted||m.pending||m.duplicateCandidates?.length||transfers.has(m.id)||!m.date.startsWith(period)||account&&m.accountId!==scope)continue;
  for(const a of m.allocations){
   if(scope!=="root"&&!account&&a.target!==scope||category!==undefined&&a.category!==category)continue;
   if(m.nature==="income"&&a.cents>=0)income+=a.cents;
   else {expenses-=a.cents;categories.set(a.category,(categories.get(a.category)??0)-a.cents);}
  }
 }
 return {income,expenses,net:income-expenses,categories};
}
export function treasuryAccounts<T extends MetricState>(s:T,scope:string,at:string):T["entities"]{
 return s.entities.filter(a=>a.kind==="account"&&(scope==="root"||scope===a.id||
  (a.treasuryAssignments?.length ? a.treasuryAssignments.some(x=>x.companyId===scope&&x.from<=at&&(!x.to||at<=x.to)) :
   s.entities.some(e=>e.id===scope&&e.kind==="company")&&s.relations.some(r=>r.kind==="holder"&&r.from===scope&&r.to===a.id))));
}
export function accountBalance(s:MetricState,id:string,at:string):number|null{
 const a=s.entities.find(e=>e.id===id&&e.kind==="account");if(!a)return null;
 const feed=s.feeds.filter(f=>f.accountId===id&&f.balance!==undefined&&f.balanceAt?.slice(0,10)===at).sort((a,b)=>(b.balanceAt??"").localeCompare(a.balanceAt??""))[0];
 if(feed)return feed.balance!;
 if(!a.opening||a.opening.date>at)return null;
 return a.opening.cents+s.movements.filter(m=>m.accountId===id&&!m.deleted&&!m.pending&&!m.duplicateCandidates?.length&&m.date>=a.opening!.date&&m.date<=at).reduce((n,m)=>n+m.cents,0);
}
