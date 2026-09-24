import {financialTotals,treasuryAccounts,accountBalance,type MetricState} from "./ecosystemMetrics.js";
export type FinancialVariable={id:string;name:string;scope:string;metric:"income"|"expenses"|"net"|"balance"|"bank_debits"|"bank_credits"|"accounting_revenue_ht"|"accounting_expenses_ht"|"vat"|"forecast_expenses";period:string;category?:string;formula?:string};
export type VariableResult={id:string;name:string;symbol:string;scope:string;period:string;unit:"EUR";calculatedAt:string;value?:number;error?:string};
export function variableSymbol(id:string){return "v_"+id.replace(/-/g,"_");}
export function resolveVariables(s:MetricState,variables:FinancialVariable[],now=new Date()):VariableResult[]{
 const results=new Map<string,VariableResult>(),visiting=new Set<string>();
 const date=now.toISOString().slice(0,10);
 function evaluate(id:string):VariableResult{
  if(results.has(id))return results.get(id)!;
  const v=variables.find(v=>v.id===id);if(!v)throw Error("Variable source introuvable : "+id);
  if(visiting.has(id))throw Error("Référence circulaire : "+v.name);
  visiting.add(id);
  const period=v.period==="current-month"?date.slice(0,7):v.period==="current-year"?date.slice(0,4):v.period;
  const result:VariableResult={id,name:v.name,symbol:variableSymbol(id),scope:v.scope,period,unit:"EUR",calculatedAt:now.toISOString()};
  try{
   if(v.formula){result.value=calculate(v.formula,ref=>{const dependency=evaluate(ref);if(dependency.error)throw Error(dependency.error);return dependency.value!;});}
   else{
    if(!["root","common","unassigned"].includes(v.scope)&&!s.entities.some(e=>e.id===v.scope))throw Error("Périmètre source introuvable");
    if(period&&!/^\d{4}(-(?:0[1-9]|1[0-2]))?$/.test(period))throw Error("Période invalide");
    if(v.metric==="balance"){
     const at=period.length===7?new Date(Date.UTC(Number(period.slice(0,4)),Number(period.slice(5)),0)).toISOString().slice(0,10):period.length===4?period+"-12-31":date;
     const accounts=treasuryAccounts(s,v.scope,at);if(!accounts.length)throw Error("Aucun compte de trésorerie explicite");
     const balances=accounts.map(a=>accountBalance(s,a.id,at));if(balances.some(b=>b===null))throw Error("Solde inconnu : renseignez les soldes initiaux");
     result.value=balances.reduce<number>((n,b)=>n+b!,0)/100;
    }else if(v.metric==="bank_debits"||v.metric==="bank_credits"){
     if(s.entities.some(e=>e.id===v.scope&&e.kind==="person"))throw Error("Choisissez un compte bancaire ou une trésorerie dédiée");
     result.value=s.movements.filter(m=>!m.deleted&&!m.pending&&!m.duplicateCandidates?.length&&m.date.startsWith(period)&&treasuryAccounts(s,v.scope,m.date).some(a=>a.id===m.accountId)).reduce((n,m)=>n+(v.metric==="bank_debits"?Math.max(0,-m.cents):Math.max(0,m.cents)),0)/100;
    }else if(["accounting_revenue_ht","accounting_expenses_ht","vat"].includes(v.metric)){
     if(!s.entities.some(e=>e.id===v.scope&&e.kind==="company"))throw Error("Une entreprise explicite est requise pour cet indicateur comptable");
     const txns=(s.treatments??[]).filter(t=>t.companyId===v.scope&&!t.transferId&&t.transaction.status==="validated"&&t.transaction.date.startsWith(period)&&(!v.category||t.transaction.category===v.category));
     result.value=txns.reduce((n,{transaction:t})=>n+(v.metric==="vat"?t.vat:v.metric==="accounting_revenue_ht"?Math.max(0,t.amount_ht):Math.max(0,-t.amount_ht)),0);
    }else if(v.metric==="forecast_expenses"){
     if(!period)throw Error("Choisissez un mois ou une année pour la prévision");
     let cents=0;for(const r of s.recurring??[]){if(!r.active||r.decision==="planned")continue;
      const amount=v.scope==="root"||v.scope===r.accountId?r.cents:-r.allocations.filter(a=>a.target===v.scope&&(!v.category||a.category===v.category)).reduce((n,a)=>n+a.cents,0);
      let due=r.nextDate;for(let guard=0;guard<1200&&due.slice(0,period.length)<=period&&(!r.endDate||due<=r.endDate);guard++){
       if(due.startsWith(period)&&due>=date)cents+=amount;
       const step=r.frequency==="monthly"?1:r.frequency==="quarterly"?3:12;const start=new Date(due+"T00:00:00Z"),day=start.getUTCDate();start.setUTCDate(1);start.setUTCMonth(start.getUTCMonth()+step);const end=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0)).getUTCDate();start.setUTCDate(Math.min(day,end));due=start.toISOString().slice(0,10);
      }
     }result.value=cents/100;
    }else{const totals=financialTotals(s,v.scope,period,v.category);result.value=totals[v.metric as "income"|"expenses"|"net"]/100;}
   }
   if(!Number.isFinite(result.value))throw Error("Résultat non fini");
  }catch(e){result.error=e instanceof Error?e.message:String(e);delete result.value;}
  visiting.delete(id);results.set(id,result);return result;
 }
 return variables.map(v=>evaluate(v.id));
}
/** Deliberately restricted arithmetic grammar: numbers, {stable-id}, + - * / and parentheses. */
export function calculate(source:string,lookup:(id:string)=>number):number{
 if(source.length>2000)throw Error("Formule trop longue");
 const tokens=source.match(/\{[a-zA-Z0-9_-]+\}|(?:\d+(?:\.\d*)?|\.\d+)|[()+*/-]|\S/g)??[];let i=0;
 function atom():number{const t=tokens[i++];if(t==="-")return -atom();if(t==="+")return atom();if(t==="("){const v=sum();if(tokens[i++]!==")")throw Error("Parenthèse manquante");return v;}if(t?.startsWith("{"))return lookup(t.slice(1,-1));if(t&&/^(\d+(\.\d*)?|\.\d+)$/.test(t))return Number(t);throw Error("Formule invalide");}
 function product():number{let v=atom();while(["*","/"].includes(tokens[i])){const op=tokens[i++],b=atom();if(op==="/"&&b===0)throw Error("Division par zéro");v=op==="*"?v*b:v/b;}return v;}
 function sum():number{let v=product();while(["+","-"].includes(tokens[i])){const op=tokens[i++],b=product();v=op==="+"?v+b:v-b;}return v;}
 const value=sum();if(i!==tokens.length||!Number.isFinite(value))throw Error("Formule invalide");return value;
}
