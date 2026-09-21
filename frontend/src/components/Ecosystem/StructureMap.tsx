import { useId, useRef, useState } from "react";
import { kinds, symbols, relationLabels, useEcosystem, type Entity, type Relation } from "./model";

type Point = {x:number;y:number};
type Layout = "columns" | "free" | "hierarchy";
export function structurePositions(entities:Entity[],relations:Relation[],layout:Layout,saved:Record<string,Point>) {
  const result=new Map<string,Point>();
  if(layout==="columns"){
    (["person","company","account"] as const).forEach((kind,column)=>
      entities.filter(e=>e.kind===kind).forEach((e,i)=>result.set(e.id,{x:24+column*280,y:60+i*106})));
    return result;
  }
  if(layout==="free"){
    // Stable concentric rings leave room for growth without moving saved nodes.
    entities.forEach((e,i)=>{
      const ring=Math.floor(i/10),angle=(i%10)/10*Math.PI*2-Math.PI/2;
      result.set(e.id,saved[e.id]??{x:Math.round(650+(450+ring*270)*Math.cos(angle)),y:Math.round(500+(350+ring*160)*Math.sin(angle))});
    });
    // Keep all positions inside the pannable document.
    for(const [id,p] of result)result.set(id,{x:Math.max(24,p.x),y:Math.max(24,p.y)});
    return result;
  }
  const companies=entities.filter(e=>e.kind==="company");
  const ranks=new Map(companies.map(e=>[e.id,0]));
  for(let i=0;i<companies.length;i++){
    let changed=false;
    for(const r of relations.filter(r=>r.kind==="subsidiary")){
      if(!ranks.has(r.from)||!ranks.has(r.to))continue;
      const next=Math.min(companies.length,(ranks.get(r.from)??0)+1);
      if(next>(ranks.get(r.to)??0)){ranks.set(r.to,next);changed=true;}
    }
    if(!changed)break;
  }
  const maxRank=Math.max(0,...ranks.values());
  const rows:Entity[][]=[entities.filter(e=>e.kind==="person")];
  for(let i=0;i<=maxRank;i++)rows.push(companies.filter(e=>ranks.get(e.id)===i));
  const accounts=entities.filter(e=>e.kind==="account");
  for(let i=0;i<accounts.length;i+=4)rows.push(accounts.slice(i,i+4));
  const widest=Math.max(3,...rows.map(row=>row.length))*270;
  rows.forEach((row,level)=>row.forEach((e,i)=>result.set(e.id,{x:24+(widest-row.length*270)/2+i*270,y:60+level*155})));
  return result;
}
export function StructureMap({entities,visible,relations,layout,zoom,selected,linked,onSelect}:{
  entities:Entity[];visible:Entity[];relations:Relation[];layout:Layout;zoom:number;selected:string;linked:Set<string>;onSelect:(id:string)=>void;
}) {
  const {positions:saved,move}=useEcosystem();
  const marker=useId();
  const positions=structurePositions(entities,relations,layout,saved);
  const drag=useRef<{id:string;pointer:number;client:Point;origin:Point;moved:boolean}|null>(null);
  const suppressClick=useRef(false);
  const [preview,setPreview]=useState<{id:string;point:Point}|null>(null);
  if(preview)positions.set(preview.id,preview.point);
  const rendered=new Set(visible.map(e=>e.id));
  const width=Math.max(850,...visible.map(e=>(positions.get(e.id)?.x??0)+270));
  const height=Math.max(420,...visible.map(e=>(positions.get(e.id)?.y??0)+130));
  function finish(cancel=false){
    const current=drag.current;
    if(current?.moved&&!cancel&&preview){move(current.id,preview.point);onSelect(current.id);}
    suppressClick.current=!!current?.moved;
    drag.current=null;setPreview(null);
  }
  return <>
    {layout==="free"&&<p className="eco-map-instructions">Déplacez les éléments librement. Au clavier : flèches pour déplacer l’élément sélectionné, Maj pour un pas plus grand. Positions enregistrées dans ce navigateur.</p>}
    {layout==="hierarchy"&&<p className="eco-map-instructions">Les entreprises mères apparaissent au-dessus de leurs participations. Les personnes et les comptes restent visibles.</p>}
    <div className="eco-map-scroll" aria-label="Carte des relations"><div style={{width:width*zoom,height:height*zoom}}>
      <div className={"eco-map "+(layout==="free"?"eco-map-free":"")} style={{width,height,transform:"scale("+zoom+")"}}>
        <svg width={width} height={height} aria-label="Liens de propriété, d’activité et de participation">
          <defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--vscode-accent)"/></marker></defs>
          {relations.map(r=>{
            const a=positions.get(r.from),b=positions.get(r.to);
            if(!a||!b||!rendered.has(r.from)||!rendered.has(r.to))return null;
            const active=selected===r.from||selected===r.to;
            const vertical=layout!=="columns"&&Math.abs(a.y-b.y)>Math.abs(a.x-b.x)*.6;
            let d:string;
            if(vertical){
              const down=a.y<b.y,ax=a.x+109,bx=b.x+109,ay=a.y+(down?72:0),by=b.y+(down?0:72);
              const bend=(ay+by)/2;
              d="M "+ax+" "+ay+" C "+ax+" "+bend+", "+bx+" "+bend+", "+bx+" "+by;
            }else if(Math.abs(a.x-b.x)<30){
              const ax=a.x+218,bx=b.x+218,bend=Math.max(ax,bx)+60;
              d="M "+ax+" "+(a.y+36)+" C "+bend+" "+(a.y+36)+", "+bend+" "+(b.y+36)+", "+bx+" "+(b.y+36);
            }else{
              const forward=a.x<b.x,ax=a.x+(forward?218:0),bx=b.x+(forward?0:218);
              d="M "+ax+" "+(a.y+36)+" C "+(ax+(forward?70:-70))+" "+(a.y+36)+", "+(bx+(forward?-70:70))+" "+(b.y+36)+", "+bx+" "+(b.y+36);
            }
            return <path key={r.id} d={d} fill="none" stroke={active||r.kind==="subsidiary"?"var(--vscode-accent)":"var(--vscode-border)"} strokeWidth={active?2.5:1.5} strokeDasharray={r.kind==="activity"?"5 4":r.kind==="usage"?"2 4":undefined} opacity={selected && !active ? .35 : 1} markerEnd={r.kind==="subsidiary"?"url(#"+marker+")":undefined}>
              <title>{relationLabels[r.kind]+": "+entities.find(e=>e.id===r.from)?.name+" → "+entities.find(e=>e.id===r.to)?.name}</title>
            </path>;
          })}
        </svg>
        {layout==="columns"&&(["PERSONNES","ENTREPRISES","COMPTES BANCAIRES"].map((name,i)=><div className="eco-column-label" style={{left:24+i*280}} key={name}>{name}</div>))}
        {visible.map(e=>{
          const p=positions.get(e.id)!;const holders=relations.filter(r=>r.to===e.id&&r.kind==="holder");
          return <button key={e.id} aria-label={"Inspecter "+e.name} aria-pressed={selected===e.id} className={"eco-node "+(selected&&!linked.has(e.id)?"eco-dim":"")} style={{left:p.x,top:p.y}} onClick={()=>{if(!suppressClick.current)onSelect(e.id);suppressClick.current=false;}}
            onPointerDown={event=>{
              if(layout!=="free"||event.button!==0)return;
              suppressClick.current=false;
              drag.current={id:e.id,pointer:event.pointerId,client:{x:event.clientX,y:event.clientY},origin:p,moved:false};
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={event=>{
              const current=drag.current;if(!current||current.id!==e.id||current.pointer!==event.pointerId)return;
              const dx=(event.clientX-current.client.x)/zoom,dy=(event.clientY-current.client.y)/zoom;
              if(Math.abs(dx)+Math.abs(dy)<4&&!current.moved)return;
              current.moved=true;
              setPreview({id:e.id,point:{x:Math.max(24,Math.round(current.origin.x+dx)),y:Math.max(24,Math.round(current.origin.y+dy))}});
            }}
            onPointerUp={()=>finish()} onPointerCancel={()=>finish(true)}
            onKeyDown={event=>{
              if(layout!=="free"||!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key))return;
              event.preventDefault();const step=event.shiftKey?40:10;
              move(e.id,{x:Math.max(24,p.x+(event.key==="ArrowRight"?step:event.key==="ArrowLeft"?-step:0)),y:Math.max(24,p.y+(event.key==="ArrowDown"?step:event.key==="ArrowUp"?-step:0))});
              onSelect(e.id);
            }}>
            <span className="eco-node-symbol">{symbols[e.kind]}</span><span><strong>{e.name}</strong><small>{e.kind==="account"?(holders.length>1?"Joint · "+holders.length+" titulaires":e.usage??"Compte"):e.kind==="company"?e.companyType??"Entreprise":kinds[e.kind]}</small></span>
          </button>;
        })}
      </div>
    </div></div>
  </>;
}

