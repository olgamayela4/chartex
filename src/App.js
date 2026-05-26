import { useState, useEffect, useRef, useCallback } from "react";

/* ─── CONFIG ─────────────────────────────────────────────────────────────── */
const FINNHUB_KEY = "d893ikpr01qla01m0u40d893ikpr01qla01m0u4g";
const FH = "https://finnhub.io/api/v1";

const SYMBOLS = [
  { id: "SPY",  name: "S&P 500 ETF",   color: "#4CAF50" },
  { id: "QQQ",  name: "Nasdaq 100 ETF",color: "#2196F3" },
  { id: "META", name: "Meta Platforms", color: "#1877F2" },
  { id: "NVDA", name: "NVIDIA Corp",    color: "#76B900" },
  { id: "AAPL", name: "Apple Inc",      color: "#A2AAAD" },
];

const TIMEFRAMES = ["1H","1D","7D","30D","90D","1Y"];
// Finnhub resolution + seconds back
const TF_CFG = {
  "1H":  { res:"5",    sec: 3600        },
  "1D":  { res:"30",   sec: 86400       },
  "7D":  { res:"60",   sec: 7*86400     },
  "30D": { res:"D",    sec: 30*86400    },
  "90D": { res:"D",    sec: 90*86400    },
  "1Y":  { res:"W",    sec: 365*86400   },
};

const TABS = ["GRÁFICA","INDICADORES","PORTFOLIO","ALERTAS","NOTICIAS","IA"];

/* ─── FORMATTERS ─────────────────────────────────────────────────────────── */
const fmt  = n => n==null?"—":n>=1000?`$${n.toLocaleString("en",{maximumFractionDigits:2})}`:`$${n.toFixed(2)}`;
const fmtV = n => n==null?"—":n>=1e9?`$${(n/1e9).toFixed(1)}B`:n>=1e6?`$${(n/1e6).toFixed(1)}M`:`$${n.toLocaleString()}`;
const fmtP = n => n==null?"—":`${n>=0?"+":""}${n.toFixed(2)}%`;
const clr  = n => n>=0?"#26a69a":"#ef5350";

/* ─── FINNHUB API ────────────────────────────────────────────────────────── */
async function fhGet(path) {
  const sep = path.includes("?")?"&":"?";
  const r = await fetch(`${FH}${path}${sep}token=${FINNHUB_KEY}`);
  return r.json();
}

async function fetchQuote(sym) {
  try {
    const [q, p] = await Promise.all([
      fhGet(`/quote?symbol=${sym}`),
      fhGet(`/stock/profile2?symbol=${sym}`)
    ]);
    if (!q || q.c == null) return null;
    return {
      price:     q.c,
      change:    q.d,
      changePct: q.dp,
      high:      q.h,
      low:       q.l,
      open:      q.o,
      prev:      q.pc,
      mcap:      p?.marketCapitalization ? p.marketCapitalization * 1e6 : null,
    };
  } catch(e) { return null; }
}

async function fetchCandles(sym, tf) {
  try {
    const { res, sec } = TF_CFG[tf];
    const to   = Math.floor(Date.now()/1000);
    const from = to - sec - 3600; // small buffer
    const d = await fhGet(`/stock/candle?symbol=${sym}&resolution=${res}&from=${from}&to=${to}`);
    if (!d || d.s !== "ok") return [];
    return d.t.map((t,i) => [t*1000, d.c[i]]).filter(([,v]) => v!=null);
  } catch(e) { return []; }
}

async function fetchNews(sym) {
  try {
    const to   = new Date().toISOString().slice(0,10);
    const from = new Date(Date.now()-7*864e5).toISOString().slice(0,10);
    const d = await fhGet(`/company-news?symbol=${sym}&from=${from}&to=${to}`);
    return Array.isArray(d) ? d.slice(0,15) : [];
  } catch(e) { return []; }
}

/* ─── MATH ───────────────────────────────────────────────────────────────── */
const sma = (arr,n) => arr.map((_,i)=>i<n-1?null:arr.slice(i-n+1,i+1).reduce((a,b)=>a+b,0)/n);
const ema = (arr,n) => { const k=2/(n+1);let r=[];arr.forEach((v,i)=>r.push(i===0?v:v*k+r[i-1]*(1-k)));return r; };
const rsiCalc = (arr,n=14) => {
  let g=[],l=[];
  for(let i=1;i<arr.length;i++){const d=arr[i]-arr[i-1];g.push(d>0?d:0);l.push(d<0?-d:0);}
  return g.map((_,i)=>{if(i<n-1)return null;const ag=g.slice(i-n+1,i+1).reduce((a,b)=>a+b,0)/n,al=l.slice(i-n+1,i+1).reduce((a,b)=>a+b,0)/n;return al===0?100:100-100/(1+ag/al);});
};
const bollinger = (arr,n=20,k=2) => {
  const mid=sma(arr,n);
  return mid.map((m,i)=>{if(m==null)return{upper:null,lower:null};const sl=arr.slice(Math.max(0,i-n+1),i+1),sd=Math.sqrt(sl.reduce((a,v)=>a+(v-m)**2,0)/sl.length);return{upper:m+k*sd,lower:m-k*sd};});
};
const macdCalc = (arr) => { const e12=ema(arr,12),e26=ema(arr,26),line=arr.map((_,i)=>e12[i]-e26[i]),sig=ema(line,9);return line.map((v,i)=>({macd:v,signal:sig[i],hist:v-sig[i]})); };

/* ─── SPARKLINE ─────────────────────────────────────────────────────────── */
function Spark({data,color}){
  if(!data||data.length<2)return<div style={{width:72,height:24}}/>;
  const w=72,h=24,mn=Math.min(...data),mx=Math.max(...data),r=mx-mn||1;
  const pts=data.map((v,i)=>`${(i/(data.length-1))*w},${h-((v-mn)/r)*h}`).join("L");
  const fill=`M0,${h-((data[0]-mn)/r)*h}L${pts}L${w},${h}L0,${h}Z`;
  const cid=color.slice(1);
  return(<svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
    <defs><linearGradient id={`sp${cid}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".25"/><stop offset="100%" stopColor={color} stopOpacity="0"/></linearGradient></defs>
    <path d={fill} fill={`url(#sp${cid})`}/><path d={`M${pts}`} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
  </svg>);
}

/* ─── PRICE CHART ────────────────────────────────────────────────────────── */
function PriceChart({chartData,color,indicators,tf}){
  const [hover,setHover]=useState(null);
  const svgRef=useRef();
  if(!chartData||chartData.length<2)return(
    <div style={{height:300,display:"flex",alignItems:"center",justifyContent:"center",color:"#333",letterSpacing:3,fontSize:11}}>SIN DATOS PARA ESTE PERÍODO</div>
  );
  const W=700,H=300,PL=70,PR=16,PT=16,PB=30,cw=W-PL-PR,ch=H-PT-PB;
  const prices=chartData.map(d=>d[1]);
  const all=[...prices];
  if(indicators.bollinger)bollinger(prices).forEach(v=>{if(v.upper)all.push(v.upper,v.lower);});
  const mn=Math.min(...all),mx=Math.max(...all),rng=mx-mn||1;
  const toX=i=>PL+(i/(chartData.length-1))*cw;
  const toY=v=>PT+ch-((v-mn)/rng)*ch;
  const lpts=chartData.map((_,i)=>`${toX(i)},${toY(prices[i])}`);
  const lp=`M${lpts.join("L")}`;
  const fp=`M${toX(0)},${toY(prices[0])}L${lpts.join("L")}L${toX(chartData.length-1)},${PT+ch}L${toX(0)},${PT+ch}Z`;
  const grid=Array.from({length:5},(_,i)=>({y:toY(mn+rng*i/4),v:mn+rng*i/4}));
  const cid=color.slice(1);
  const isIntra=tf==="1H"||tf==="1D";
  const lbl=ts=>isIntra?new Date(ts).toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"}):new Date(ts).toLocaleDateString("es-MX",{month:"short",day:"numeric"});
  let sma20p=null,ema50p=null,bollp=null;
  if(indicators.sma20){const s=sma(prices,20);sma20p=s.reduce((a,v,i)=>v==null?a:a+(a?`L${toX(i)},${toY(v)}`:`M${toX(i)},${toY(v)}`),"");}
  if(indicators.ema50&&prices.length>=50){const e=ema(prices,50);ema50p=e.reduce((a,v,i)=>a+`${i===0?'M':'L'}${toX(i)},${toY(v)}`,"");}
  if(indicators.bollinger){const b=bollinger(prices);bollp={u:b.reduce((a,v,i)=>v.upper==null?a:a+(a?`L${toX(i)},${toY(v.upper)}`:`M${toX(i)},${toY(v.upper)}`),""),l:b.reduce((a,v,i)=>v.lower==null?a:a+(a?`L${toX(i)},${toY(v.lower)}`:`M${toX(i)},${toY(v.lower)}`),"") };}
  const onMove=e=>{
    if(!svgRef.current)return;
    const rect=svgRef.current.getBoundingClientRect();
    const mx=(e.clientX-rect.left)*(W/rect.width);
    const idx=Math.max(0,Math.min(chartData.length-1,Math.round(((mx-PL)/cw)*(chartData.length-1))));
    setHover({x:toX(idx),y:toY(prices[idx]),price:prices[idx],date:chartData[idx][0]});
  };
  return(<div style={{position:"relative"}}>
    {hover&&<div style={{position:"absolute",top:4,left:PL,background:"#0d0d0d",border:`1px solid ${color}44`,borderRadius:4,padding:"3px 10px",fontSize:11,color:"#eee",pointerEvents:"none",zIndex:9}}>
      <b style={{color}}>{fmt(hover.price)}</b><span style={{color:"#555",marginLeft:8}}>{lbl(hover.date)}</span>
    </div>}
    <svg ref={svgRef} width="100%" viewBox={`0 0 ${W} ${H}`} style={{cursor:"crosshair"}} onMouseMove={onMove} onMouseLeave={()=>setHover(null)}>
      <defs><linearGradient id={`cg${cid}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".15"/><stop offset="100%" stopColor={color} stopOpacity="0"/></linearGradient></defs>
      {grid.map((g,i)=><g key={i}><line x1={PL} y1={g.y} x2={W-PR} y2={g.y} stroke="#161616" strokeWidth="1"/><text x={PL-6} y={g.y+4} textAnchor="end" fontSize="10" fill="#404040">${g.v.toFixed(0)}</text></g>)}
      <path d={fp} fill={`url(#cg${cid})`}/>
      {bollp&&<><path d={bollp.u} fill="none" stroke="#88888888" strokeWidth="1" strokeDasharray="3,3"/><path d={bollp.l} fill="none" stroke="#88888888" strokeWidth="1" strokeDasharray="3,3"/></>}
      {sma20p&&<path d={sma20p} fill="none" stroke="#FFD700" strokeWidth="1.5" opacity=".85"/>}
      {ema50p&&<path d={ema50p} fill="none" stroke="#FF6B9D" strokeWidth="1.5" opacity=".85"/>}
      <path d={lp} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      {[0,Math.floor(chartData.length/2),chartData.length-1].map(i=><text key={i} x={toX(i)} y={H-4} textAnchor="middle" fontSize="10" fill="#404040">{lbl(chartData[i][0])}</text>)}
      {hover&&<><line x1={hover.x} y1={PT} x2={hover.x} y2={PT+ch} stroke={color} strokeWidth="1" strokeDasharray="3,3" opacity=".4"/><circle cx={hover.x} cy={hover.y} r={4} fill={color} stroke="#090909" strokeWidth="2"/></>}
    </svg>
  </div>);
}

/* ─── RSI ────────────────────────────────────────────────────────────────── */
function RSIChart({prices}){
  if(!prices||prices.length<15)return null;
  const vals=rsiCalc(prices);
  const W=700,H=90,PL=70,PR=16,PT=8,PB=20,cw=W-PL-PR,ch=H-PT-PB;
  const toX=i=>PL+(i/(vals.length-1))*cw,toY=v=>PT+ch-((v||0)/100)*ch;
  const path=vals.reduce((a,v,i)=>v==null?a:a+(a?`L${toX(i)},${toY(v)}`:`M${toX(i)},${toY(v)}`),"");
  return(<svg width="100%" viewBox={`0 0 ${W} ${H}`}>
    <line x1={PL} y1={toY(70)} x2={W-PR} y2={toY(70)} stroke="#ef535044" strokeWidth="1" strokeDasharray="3,2"/>
    <line x1={PL} y1={toY(30)} x2={W-PR} y2={toY(30)} stroke="#26a69a44" strokeWidth="1" strokeDasharray="3,2"/>
    <text x={PL-6} y={toY(70)+4} textAnchor="end" fontSize="9" fill="#ef5350">70</text>
    <text x={PL-6} y={toY(30)+4} textAnchor="end" fontSize="9" fill="#26a69a">30</text>
    <path d={path} fill="none" stroke="#9945FF" strokeWidth="1.5"/>
    <text x={PL} y={H-4} fontSize="9" fill="#555">RSI (14)</text>
  </svg>);
}

/* ─── MACD ───────────────────────────────────────────────────────────────── */
function MACDChart({prices}){
  if(!prices||prices.length<27)return null;
  const vals=macdCalc(prices);
  const W=700,H=90,PL=70,PR=16,PT=8,PB=20,cw=W-PL-PR,ch=H-PT-PB;
  const allV=vals.flatMap(v=>[v.macd,v.signal,v.hist]).filter(Boolean);
  const mn=Math.min(...allV),mx=Math.max(...allV),rng=mx-mn||1;
  const toX=i=>PL+(i/(vals.length-1))*cw,toY=v=>PT+ch-((v-mn)/rng)*ch;
  const bw=cw/vals.length*0.6;
  const mp=vals.reduce((a,v,i)=>a+`${i===0?'M':'L'}${toX(i)},${toY(v.macd)}`,"");
  const sp=vals.reduce((a,v,i)=>a+`${i===0?'M':'L'}${toX(i)},${toY(v.signal)}`,"");
  return(<svg width="100%" viewBox={`0 0 ${W} ${H}`}>
    {vals.map((v,i)=><rect key={i} x={toX(i)-bw/2} y={v.hist>=0?toY(v.hist):toY(0)} width={bw} height={Math.abs(toY(v.hist)-toY(0))} fill={v.hist>=0?"#26a69a66":"#ef535066"}/>)}
    <path d={mp} fill="none" stroke="#FFD700" strokeWidth="1.2"/>
    <path d={sp} fill="none" stroke="#FF6B9D" strokeWidth="1.2"/>
    <text x={PL} y={H-4} fontSize="9" fill="#555">MACD (12,26,9)</text>
  </svg>);
}

/* ─── PORTFOLIO ──────────────────────────────────────────────────────────── */
function PortfolioTab({prices}){
  const [pos,setPos]=useState([
    {id:"SPY", qty:10,avg:480},
    {id:"NVDA",qty:5, avg:800},
    {id:"AAPL",qty:20,avg:170},
  ]);
  const [form,setForm]=useState({id:"SPY",qty:"",avg:""});
  const total=pos.reduce((a,p)=>a+(prices[p.id]?.price||0)*p.qty,0);
  const cost=pos.reduce((a,p)=>a+p.avg*p.qty,0);
  const pnl=total-cost;
  const add=()=>{if(!form.qty||!form.avg)return;setPos(p=>[...p,{id:form.id,qty:+form.qty,avg:+form.avg}]);setForm(f=>({...f,qty:"",avg:""}));};
  return(<div style={{padding:"16px 0"}}>
    <div style={{display:"flex",gap:12,marginBottom:20}}>
      {[["VALOR",fmt(total),null],["COSTO",fmt(cost),null],["P&L",fmtP(cost?(pnl/cost)*100:0),pnl]].map(([l,v,p],i)=>(
        <div key={i} style={{flex:1,background:"#0e0e0e",border:"1px solid #1a1a1a",borderRadius:6,padding:"12px 16px"}}>
          <div style={{color:"#444",fontSize:10,letterSpacing:2,marginBottom:4}}>{l}</div>
          <div style={{color:p!=null?clr(p):"#eee",fontSize:18,fontWeight:700}}>{v}</div>
          {p!=null&&<div style={{color:clr(p),fontSize:11}}>{fmt(Math.abs(pnl))}</div>}
        </div>
      ))}
    </div>
    <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
      <thead><tr style={{color:"#444",borderBottom:"1px solid #1a1a1a"}}>
        {["TICKER","QTY","COSTO","PRECIO","VALOR","P&L",""].map(h=><th key={h} style={{padding:"8px 10px",textAlign:"left",fontWeight:400,fontSize:10,letterSpacing:1}}>{h}</th>)}
      </tr></thead>
      <tbody>{pos.map((p,i)=>{
        const cp=prices[p.id]?.price||0,val=cp*p.qty,c=p.avg*p.qty,pl=val-c,pct=(pl/c)*100;
        const s=SYMBOLS.find(s=>s.id===p.id);
        return(<tr key={i} style={{borderBottom:"1px solid #0e0e0e"}}>
          <td style={{padding:"10px",color:s?.color||"#eee",fontWeight:700}}>{p.id}</td>
          <td style={{padding:"10px",color:"#aaa"}}>{p.qty}</td>
          <td style={{padding:"10px",color:"#aaa"}}>{fmt(p.avg)}</td>
          <td style={{padding:"10px",color:"#ddd"}}>{fmt(cp)}</td>
          <td style={{padding:"10px",color:"#ddd"}}>{fmt(val)}</td>
          <td style={{padding:"10px",color:clr(pl)}}><div>{fmt(Math.abs(pl))}</div><div style={{fontSize:10}}>{fmtP(pct)}</div></td>
          <td style={{padding:"10px"}}><button onClick={()=>setPos(p=>p.filter((_,j)=>j!==i))} style={{background:"#1a1a1a",border:"none",color:"#ef5350",cursor:"pointer",padding:"3px 8px",borderRadius:3,fontSize:10}}>✕</button></td>
        </tr>);
      })}</tbody>
    </table>
    <div style={{marginTop:16,display:"flex",gap:8,alignItems:"center",background:"#0a0a0a",padding:12,borderRadius:6,border:"1px solid #1a1a1a"}}>
      <select value={form.id} onChange={e=>setForm(f=>({...f,id:e.target.value}))} style={{background:"#141414",border:"1px solid #222",color:"#ddd",padding:"6px 10px",borderRadius:4,fontFamily:"inherit",fontSize:12}}>
        {SYMBOLS.map(s=><option key={s.id} value={s.id}>{s.id} – {s.name}</option>)}
      </select>
      <input placeholder="Acciones" type="number" value={form.qty} onChange={e=>setForm(f=>({...f,qty:e.target.value}))} style={{background:"#141414",border:"1px solid #222",color:"#ddd",padding:"6px 10px",borderRadius:4,width:90,fontFamily:"inherit",fontSize:12}}/>
      <input placeholder="Precio promedio" type="number" value={form.avg} onChange={e=>setForm(f=>({...f,avg:e.target.value}))} style={{background:"#141414",border:"1px solid #222",color:"#ddd",padding:"6px 10px",borderRadius:4,width:150,fontFamily:"inherit",fontSize:12}}/>
      <button onClick={add} style={{background:"#26a69a",border:"none",color:"#000",padding:"6px 16px",borderRadius:4,cursor:"pointer",fontFamily:"inherit",fontWeight:700,fontSize:12}}>+ AGREGAR</button>
    </div>
  </div>);
}

/* ─── ALERTS ─────────────────────────────────────────────────────────────── */
function AlertsTab({prices}){
  const [alerts,setAlerts]=useState([
    {id:"SPY", type:"above",target:600, triggered:false},
    {id:"NVDA",type:"below",target:800, triggered:false},
  ]);
  const [form,setForm]=useState({id:"SPY",type:"above",target:""});
  const [fired,setFired]=useState([]);
  useEffect(()=>{alerts.forEach((a,i)=>{const cp=prices[a.id]?.price;if(!cp||a.triggered)return;if((a.type==="above"&&cp>a.target)||(a.type==="below"&&cp<a.target)){setAlerts(arr=>arr.map((x,j)=>j===i?{...x,triggered:true}:x));setFired(f=>[...f,{...a,price:cp,time:new Date()}]);}});},[prices]);
  const add=()=>{if(!form.target)return;setAlerts(a=>[...a,{...form,target:+form.target,triggered:false}]);setForm(f=>({...f,target:""}));};
  return(<div style={{padding:"16px 0"}}>
    {fired.length>0&&<div style={{marginBottom:16}}>
      <div style={{color:"#FFD700",fontSize:11,letterSpacing:2,marginBottom:8}}>⚡ DISPARADAS</div>
      {fired.map((a,i)=><div key={i} style={{background:"#FFD70011",border:"1px solid #FFD70044",borderRadius:6,padding:"10px 14px",marginBottom:6,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{color:"#FFD700",fontWeight:700}}>{a.id}</span>
        <span style={{color:"#aaa",fontSize:12}}>{a.type==="above"?"↑ sobre":"↓ bajo"} {fmt(a.target)}</span>
        <span style={{color:"#26a69a"}}>Hit: {fmt(a.price)}</span>
        <span style={{color:"#555",fontSize:11}}>{a.time.toLocaleTimeString("es-MX")}</span>
      </div>)}
    </div>}
    <div style={{color:"#444",fontSize:10,letterSpacing:2,marginBottom:10}}>ALERTAS ACTIVAS</div>
    {alerts.filter(a=>!a.triggered).length===0&&<div style={{color:"#333",fontSize:12,padding:"12px 0"}}>Sin alertas activas.</div>}
    {alerts.filter(a=>!a.triggered).map((a,i)=>{
      const cp=prices[a.id]?.price,dist=cp?(((a.target-cp)/cp)*100):null;
      return(<div key={i} style={{background:"#0e0e0e",border:"1px solid #1a1a1a",borderRadius:6,padding:"12px 16px",marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{display:"flex",gap:12,alignItems:"center"}}>
          <span style={{color:SYMBOLS.find(s=>s.id===a.id)?.color||"#eee",fontWeight:700,fontSize:14}}>{a.id}</span>
          <span style={{color:"#555",fontSize:12}}>{a.type==="above"?"↑ sobre":"↓ bajo"}</span>
          <span style={{color:"#ddd",fontWeight:700}}>{fmt(a.target)}</span>
        </div>
        <div style={{display:"flex",gap:16,alignItems:"center"}}>
          {dist!=null&&<span style={{color:clr(-dist),fontSize:12}}>{fmtP(dist)} distancia</span>}
          <button onClick={()=>setAlerts(arr=>arr.filter((_,j)=>j!==i))} style={{background:"#1a1a1a",border:"none",color:"#ef5350",cursor:"pointer",padding:"3px 8px",borderRadius:3,fontSize:10}}>✕</button>
        </div>
      </div>);
    })}
    <div style={{marginTop:16,display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",background:"#0a0a0a",padding:12,borderRadius:6,border:"1px solid #1a1a1a"}}>
      <select value={form.id} onChange={e=>setForm(f=>({...f,id:e.target.value}))} style={{background:"#141414",border:"1px solid #222",color:"#ddd",padding:"6px 10px",borderRadius:4,fontFamily:"inherit",fontSize:12}}>
        {SYMBOLS.map(s=><option key={s.id} value={s.id}>{s.id}</option>)}
      </select>
      <select value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))} style={{background:"#141414",border:"1px solid #222",color:"#ddd",padding:"6px 10px",borderRadius:4,fontFamily:"inherit",fontSize:12}}>
        <option value="above">↑ Por encima de</option>
        <option value="below">↓ Por debajo de</option>
      </select>
      <input placeholder="Precio objetivo ($)" type="number" value={form.target} onChange={e=>setForm(f=>({...f,target:e.target.value}))} style={{background:"#141414",border:"1px solid #222",color:"#ddd",padding:"6px 10px",borderRadius:4,width:170,fontFamily:"inherit",fontSize:12}}/>
      <button onClick={add} style={{background:"#2196F3",border:"none",color:"#fff",padding:"6px 16px",borderRadius:4,cursor:"pointer",fontFamily:"inherit",fontWeight:700,fontSize:12}}>+ ALERTA</button>
    </div>
  </div>);
}

/* ─── NEWS ───────────────────────────────────────────────────────────────── */
function NewsTab({newsBySymbol,loadingNews,activeSym}){
  const [filter,setFilter]=useState("ALL");
  const tags=["ALL",...SYMBOLS.map(s=>s.id)];
  const pool=filter==="ALL"?Object.values(newsBySymbol).flat():newsBySymbol[filter]||[];
  const seen=new Set(); const unique=pool.filter(n=>{if(seen.has(n.id))return false;seen.add(n.id);return true;}).slice(0,20);
  const ago=ts=>{const d=(Date.now()-ts*1000)/60000;return d<60?`${Math.round(d)}m`:d<1440?`${Math.round(d/60)}h`:`${Math.round(d/1440)}d`;};
  return(<div style={{padding:"16px 0"}}>
    <div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap"}}>
      {tags.map(t=><button key={t} onClick={()=>setFilter(t)} style={{background:filter===t?"#1e1e1e":"transparent",border:`1px solid ${filter===t?"#333":"#1a1a1a"}`,color:filter===t?"#ddd":"#555",padding:"4px 12px",borderRadius:20,cursor:"pointer",fontFamily:"inherit",fontSize:11}}>{t}</button>)}
    </div>
    {loadingNews&&<div style={{color:"#333",fontSize:12,padding:12}}>Cargando noticias de Finnhub...</div>}
    {!loadingNews&&unique.length===0&&<div style={{color:"#333",fontSize:12,padding:12}}>Sin noticias recientes.</div>}
    {unique.map((n,i)=>(
      <a key={i} href={n.url} target="_blank" rel="noreferrer" style={{textDecoration:"none",display:"block",borderBottom:"1px solid #0e0e0e",padding:"12px 0"}}>
        <div style={{display:"flex",gap:12,alignItems:"flex-start"}}>
          <div style={{width:3,borderRadius:2,alignSelf:"stretch",background:"#26a69a",flexShrink:0,minHeight:40}}/>
          <div style={{flex:1}}>
            <div style={{color:"#ccc",fontSize:13,marginBottom:4,lineHeight:1.4}}>{n.headline}</div>
            <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
              <span style={{color:"#555",fontSize:11}}>{n.source}</span>
              <span style={{color:"#222"}}>·</span>
              <span style={{color:"#3a3a3a",fontSize:11}}>{ago(n.datetime)}</span>
              {n.related&&<span style={{background:"#26a69a18",color:"#26a69a",padding:"1px 7px",borderRadius:10,fontSize:10}}>{n.related}</span>}
            </div>
          </div>
          <span style={{color:"#26a69a",fontSize:12,flexShrink:0}}>↗</span>
        </div>
      </a>
    ))}
  </div>);
}

/* ─── AI TAB ─────────────────────────────────────────────────────────────── */
function AITab({selected,prices,chartData,tf}){
  const [analysis,setAnalysis]=useState("");
  const [loading,setLoading]=useState(false);
  const [q,setQ]=useState("");
  const [chat,setChat]=useState([]);
  const analyze=async()=>{
    setLoading(true);setAnalysis("");
    const info=prices[selected.id];
    const recent=(chartData||[]).slice(-30).map(d=>d[1]);
    const mn=Math.min(...recent),mx=Math.max(...recent);
    const rsiVals=rsiCalc(recent),lastRsi=rsiVals.filter(Boolean).slice(-1)[0];
    const prompt=`Eres analista técnico experto en acciones de EE.UU. Analiza ${selected.name} (${selected.id}):

Precio: ${fmt(info?.price)} | Cambio: ${fmtP(info?.changePct)} (${fmt(info?.change)})
Open: ${fmt(info?.open)} | High: ${fmt(info?.high)} | Low: ${fmt(info?.low)}
Marco temporal: ${tf} | Mín período: ${fmt(mn)} | Máx período: ${fmt(mx)}
RSI(14): ${lastRsi?.toFixed(1)||"N/A"}

Proporciona análisis con:
1. TÉCNICO (situación actual 2-3 oraciones)
2. SEÑALES (bullish/bearish/neutral + razones)
3. NIVELES CLAVE (soporte y resistencia concretos)
4. PERSPECTIVA (corto y mediano plazo)
5. RIESGO (nivel: bajo/medio/alto + razón)

Sé directo, usa números concretos. Responde en español.`;
    try{
      const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1000,messages:[{role:"user",content:prompt}]})});
      const d=await res.json();setAnalysis(d.content?.[0]?.text||"Error.");
    }catch(e){setAnalysis("Error de conexión.");}
    setLoading(false);
  };
  const ask=async()=>{
    if(!q.trim())return;const question=q;setQ("");
    const info=prices[selected.id];
    const newChat=[...chat,{role:"user",text:question}];setChat(newChat);
    const messages=newChat.map(m=>({role:m.role==="user"?"user":"assistant",content:m.text}));
    try{
      const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:600,system:`Eres asesor de trading para acciones de EE.UU. Activo: ${selected.name} (${selected.id}), precio: ${fmt(info?.price)}, cambio: ${fmtP(info?.changePct)}. Responde en español de forma concisa.`,messages})});
      const d=await res.json();setChat(c=>[...c,{role:"assistant",text:d.content?.[0]?.text||"Sin respuesta."}]);
    }catch(e){setChat(c=>[...c,{role:"assistant",text:"Error de conexión."}]);}
  };
  return(<div style={{padding:"16px 0"}}>
    <div style={{background:"#0a0a0a",border:"1px solid #1a1a1a",borderRadius:6,padding:16,marginBottom:16}}>
      <div style={{color:"#444",fontSize:10,letterSpacing:2,marginBottom:10}}>ANÁLISIS IA — {selected.id} · {tf}</div>
      {!analysis&&!loading&&<div style={{color:"#333",fontSize:12,marginBottom:12}}>Presiona para que la IA analice {selected.name} con datos reales de Finnhub.</div>}
      {loading&&<div style={{display:"flex",gap:8,alignItems:"center",color:selected.color,fontSize:12,marginBottom:12}}><span style={{animation:"spin 1s linear infinite",display:"inline-block"}}>◌</span> Analizando...</div>}
      {analysis&&<div style={{color:"#ccc",fontSize:12,lineHeight:1.8,whiteSpace:"pre-wrap",maxHeight:300,overflowY:"auto"}}>{analysis}</div>}
      <button onClick={analyze} disabled={loading} style={{marginTop:10,background:loading?"#1a1a1a":selected.color,border:"none",color:loading?"#555":"#000",padding:"8px 20px",borderRadius:4,cursor:loading?"default":"pointer",fontFamily:"inherit",fontWeight:700,fontSize:12,letterSpacing:1}}>
        {loading?"ANALIZANDO...":"⚡ ANALIZAR CON IA"}
      </button>
    </div>
    <div style={{background:"#0a0a0a",border:"1px solid #1a1a1a",borderRadius:6,padding:16}}>
      <div style={{color:"#444",fontSize:10,letterSpacing:2,marginBottom:10}}>CHAT — TRADING ADVISOR</div>
      <div style={{maxHeight:240,overflowY:"auto",marginBottom:12}}>
        {chat.length===0&&<div style={{color:"#333",fontSize:12}}>Pregúntame sobre {selected.name}, niveles de soporte, opciones, catalizadores, o lo que necesites.</div>}
        {chat.map((m,i)=>(
          <div key={i} style={{marginBottom:10,display:"flex",gap:8,flexDirection:m.role==="user"?"row-reverse":"row",alignItems:"flex-start"}}>
            <div style={{width:24,height:24,borderRadius:4,background:m.role==="user"?"#1e1e1e":`${selected.color}22`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,flexShrink:0,color:m.role==="user"?"#555":selected.color}}>{m.role==="user"?"TÚ":"AI"}</div>
            <div style={{background:m.role==="user"?"#141414":"#0e0e0e",border:`1px solid ${m.role==="user"?"#1e1e1e":"#161616"}`,borderRadius:6,padding:"8px 12px",fontSize:12,color:"#ccc",lineHeight:1.6,maxWidth:"85%"}}>{m.text}</div>
          </div>
        ))}
      </div>
      <div style={{display:"flex",gap:8}}>
        <input value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==="Enter"&&ask()} placeholder={`Pregunta sobre ${selected.id}...`} style={{flex:1,background:"#141414",border:"1px solid #222",color:"#ddd",padding:"8px 12px",borderRadius:4,fontFamily:"inherit",fontSize:12,outline:"none"}}/>
        <button onClick={ask} style={{background:selected.color,border:"none",color:"#000",padding:"8px 16px",borderRadius:4,cursor:"pointer",fontFamily:"inherit",fontWeight:700,fontSize:12}}>→</button>
      </div>
    </div>
    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
  </div>);
}

/* ─── INDICATORS TAB ─────────────────────────────────────────────────────── */
function IndicatorsTab({chartData,indicators,setIndicators}){
  if(!chartData||chartData.length<2)return<div style={{color:"#333",padding:20}}>Cargando...</div>;
  const prices=chartData.map(d=>d[1]);
  const INDS=[
    {key:"sma20",label:"SMA (20)",color:"#FFD700",desc:"Media móvil simple 20 períodos"},
    {key:"ema50",label:"EMA (50)",color:"#FF6B9D",desc:"Media móvil exponencial 50 períodos"},
    {key:"bollinger",label:"Bollinger (20,2)",color:"#888",desc:"Bandas de volatilidad ±2σ"},
    {key:"rsi",label:"RSI (14)",color:"#9945FF",desc:"Índice de fuerza relativa"},
    {key:"macd",label:"MACD (12,26,9)",color:"#FFD700",desc:"Convergencia/divergencia de medias"},
  ];
  return(<div style={{padding:"16px 0"}}>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:20}}>
      {INDS.map(ind=>(
        <div key={ind.key} onClick={()=>setIndicators(s=>({...s,[ind.key]:!s[ind.key]}))} style={{background:indicators[ind.key]?"#0e0e0e":"#080808",border:`1px solid ${indicators[ind.key]?ind.color+"55":"#1a1a1a"}`,borderRadius:6,padding:"12px 14px",cursor:"pointer",transition:"all 0.15s"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
            <div style={{width:10,height:10,borderRadius:2,background:indicators[ind.key]?ind.color:"#222"}}/>
            <span style={{color:indicators[ind.key]?"#ddd":"#555",fontWeight:700,fontSize:12}}>{ind.label}</span>
          </div>
          <div style={{color:"#444",fontSize:11}}>{ind.desc}</div>
        </div>
      ))}
    </div>
    {indicators.rsi&&<><div style={{color:"#444",fontSize:10,letterSpacing:2,marginBottom:4}}>RSI (14)</div><RSIChart prices={prices}/></>}
    {indicators.macd&&<><div style={{color:"#444",fontSize:10,letterSpacing:2,marginTop:12,marginBottom:4}}>MACD</div><MACDChart prices={prices}/></>}
    {!indicators.rsi&&!indicators.macd&&<div style={{color:"#333",fontSize:12,padding:"20px 0"}}>Activa RSI o MACD para ver osciladores aquí.</div>}
  </div>);
}

/* ─── ROOT ───────────────────────────────────────────────────────────────── */
export default function App(){
  const [sel,setSel]         = useState(SYMBOLS[0]);
  const [tf,setTf]           = useState("1D");
  const [tab,setTab]         = useState("GRÁFICA");
  const [prices,setPrices]   = useState({});
  const [sparks,setSparks]   = useState({});
  const [chartData,setChart] = useState(null);
  const [loading,setLoading] = useState(false);
  const [indicators,setInd]  = useState({sma20:false,ema50:false,bollinger:false,rsi:false,macd:false});
  const [news,setNews]       = useState({});
  const [loadingNews,setLN]  = useState(false);
  const [tick,setTick]       = useState(0);
  const [mktStatus,setMkt]   = useState("—");

  // Market hours
  useEffect(()=>{
    const check=()=>{
      const et=new Date(new Date().toLocaleString("en-US",{timeZone:"America/New_York"}));
      const day=et.getDay(),t=et.getHours()*60+et.getMinutes();
      if(day===0||day===6){setMkt("CERRADO");return;}
      if(t>=570&&t<960)setMkt("ABIERTO");
      else if(t>=240&&t<570)setMkt("PRE-MARKET");
      else if(t>=960&&t<1200)setMkt("AFTER-HOURS");
      else setMkt("CERRADO");
    };
    check();const i=setInterval(check,30000);return()=>clearInterval(i);
  },[]);

  // Fetch all quotes
  const fetchPrices=useCallback(async()=>{
    const res={};
    await Promise.all(SYMBOLS.map(async s=>{const q=await fetchQuote(s.id);if(q)res[s.id]=q;}));
    setPrices(res);
  },[]);

  // Fetch sparklines (7D daily)
  const fetchSparks=useCallback(async()=>{
    const sm={};
    await Promise.all(SYMBOLS.map(async s=>{const d=await fetchCandles(s.id,"7D");sm[s.id]=d.map(x=>x[1]);}));
    setSparks(sm);
  },[]);

  // Fetch chart
  const fetchChart=useCallback(async(id,tf)=>{
    setLoading(true);setChart(null);
    const d=await fetchCandles(id,tf);
    setChart(d);setLoading(false);
  },[]);

  // Fetch news
  const fetchNews2=useCallback(async()=>{
    setLN(true);
    const nm={};
    await Promise.all(SYMBOLS.map(async s=>{nm[s.id]=await fetchNews(s.id);}));
    setNews(nm);setLN(false);
  },[]);

  useEffect(()=>{fetchPrices();fetchSparks();fetchNews2();const t=setInterval(()=>{fetchPrices();setTick(x=>x+1);},60000);return()=>clearInterval(t);},[]);
  useEffect(()=>{fetchChart(sel.id,tf);},[sel,tf]);

  const info=prices[sel.id];
  const pos=(info?.changePct||0)>=0;
  const mktCol=mktStatus==="ABIERTO"?"#26a69a":mktStatus==="PRE-MARKET"||mktStatus==="AFTER-HOURS"?"#FFD700":"#555";

  return(<div style={{background:"#060606",minHeight:"100vh",color:"#e0e0e0",fontFamily:"'IBM Plex Mono','Courier New',monospace",fontSize:13,display:"flex",flexDirection:"column"}}>
    {/* HEADER */}
    <div style={{borderBottom:"1px solid #141414",padding:"0 20px",display:"flex",alignItems:"center",height:44,background:"#080808",flexShrink:0}}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginRight:24}}>
        <svg width="18" height="18" viewBox="0 0 18 18"><polyline points="1,13 6,7 10,10 17,3" fill="none" stroke={sel.color} strokeWidth="2" strokeLinecap="round"/><circle cx="17" cy="3" r="2" fill={sel.color}/></svg>
        <span style={{fontWeight:700,fontSize:14,letterSpacing:3,color:"#fff"}}>CHARTEX</span>
        <span style={{color:"#2a2a2a",fontSize:9,letterSpacing:2}}>PRO</span>
      </div>
      <div style={{display:"flex",gap:0,height:"100%"}}>
        {TABS.map(t=><button key={t} onClick={()=>setTab(t)} style={{background:"transparent",border:"none",borderBottom:`2px solid ${tab===t?sel.color:"transparent"}`,color:tab===t?"#ddd":"#444",padding:"0 14px",cursor:"pointer",fontFamily:"inherit",fontSize:11,fontWeight:700,letterSpacing:1,height:"100%",transition:"all 0.15s"}}>{t}</button>)}
      </div>
      <div style={{marginLeft:"auto",display:"flex",gap:10,alignItems:"center"}}>
        <span style={{color:mktCol,fontSize:10,fontWeight:700,letterSpacing:1}}>{mktStatus}</span>
        <span style={{color:"#1e1e1e"}}>·</span>
        <span style={{color:"#2a2a2a",fontSize:10}}>NYSE/NASDAQ · ET</span>
        <span style={{color:"#1e1e1e"}}>·</span>
        <span style={{color:"#2a2a2a",fontSize:10}}>Finnhub</span>
      </div>
    </div>

    <div style={{display:"flex",flex:1,minHeight:0}}>
      {/* SIDEBAR */}
      <div style={{width:200,borderRight:"1px solid #0e0e0e",background:"#060606",overflowY:"auto",flexShrink:0}}>
        <div style={{padding:"10px 14px 6px",color:"#1e1e1e",fontSize:9,letterSpacing:3}}>ACCIONES US</div>
        {SYMBOLS.map(s=>{
          const p=prices[s.id],pct=p?.changePct||0,isA=sel.id===s.id;
          return(<div key={s.id} onClick={()=>setSel(s)} style={{padding:"9px 14px",cursor:"pointer",borderLeft:`2px solid ${isA?s.color:"transparent"}`,background:isA?"#0c0c0c":"transparent",transition:"all 0.12s"}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
              <div>
                <div style={{color:isA?s.color:"#aaa",fontWeight:700,fontSize:13}}>{s.id}</div>
                <div style={{color:"#242424",fontSize:9}}>{s.name}</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{color:"#bbb",fontSize:12}}>{p?fmt(p.price):"—"}</div>
                <div style={{color:clr(pct),fontSize:10}}>{p?fmtP(pct):"—"}</div>
              </div>
            </div>
            <Spark data={sparks[s.id]} color={s.color}/>
          </div>);
        })}
      </div>

      {/* MAIN */}
      <div style={{flex:1,display:"flex",flexDirection:"column",minWidth:0,overflow:"hidden"}}>
        {/* TICKER */}
        <div style={{borderBottom:"1px solid #0e0e0e",padding:"10px 20px",display:"flex",alignItems:"center",gap:16,flexWrap:"wrap",background:"#070707",flexShrink:0}}>
          <div style={{display:"flex",alignItems:"baseline",gap:10}}>
            <span style={{color:sel.color,fontWeight:700,fontSize:15}}>{sel.id}</span>
            <span style={{color:"#fff",fontSize:20,fontWeight:700}}>{info?fmt(info.price):"—"}</span>
            {info&&<span style={{color:clr(info.changePct||0),fontSize:12,background:`${clr(info.changePct||0)}18`,padding:"2px 8px",borderRadius:3}}>
              {fmtP(info.changePct)} ({info.change>=0?"+":""}{fmt(info.change)})
            </span>}
          </div>
          <div style={{display:"flex",gap:14,marginLeft:"auto",flexWrap:"wrap"}}>
            {[["O",fmt(info?.open),null],["H",fmt(info?.high),"#26a69a"],["L",fmt(info?.low),"#ef5350"],["VOL",fmtV(info?.volume),null],["MCAP",fmtV(info?.mcap),null]].map(([l,v,c])=>(
              <div key={l} style={{fontSize:11}}><span style={{color:"#2a2a2a"}}>{l} </span><span style={{color:c||"#666"}}>{v}</span></div>
            ))}
          </div>
        </div>

        {/* CONTENT */}
        <div style={{flex:1,overflowY:"auto",padding:"0 20px"}}>
          {tab==="GRÁFICA"&&<>
            <div style={{display:"flex",gap:0,padding:"10px 0",alignItems:"center",flexWrap:"wrap"}}>
              {TIMEFRAMES.map(t=><button key={t} onClick={()=>setTf(t)} style={{background:tf===t?sel.color:"transparent",color:tf===t?"#000":"#555",border:"none",padding:"4px 11px",borderRadius:3,cursor:"pointer",fontFamily:"inherit",fontSize:11,fontWeight:700,letterSpacing:1}}>{t}</button>)}
              {tf==="1H"&&<span style={{color:"#333",fontSize:10,marginLeft:6}}>velas 5min</span>}
              <div style={{marginLeft:14,display:"flex",gap:5}}>
                {[["SMA","sma20","#FFD700"],["EMA","ema50","#FF6B9D"],["BB","bollinger","#888"]].map(([l,k,c])=>(
                  <button key={k} onClick={()=>setInd(s=>({...s,[k]:!s[k]}))} style={{background:indicators[k]?`${c}22`:"transparent",border:`1px solid ${indicators[k]?c:"#1a1a1a"}`,color:indicators[k]?c:"#444",padding:"3px 9px",borderRadius:3,cursor:"pointer",fontFamily:"inherit",fontSize:10}}>{l}</button>
                ))}
              </div>
            </div>
            {loading
              ?<div style={{height:280,display:"flex",alignItems:"center",justifyContent:"center",color:sel.color,letterSpacing:3,fontSize:11}}>CARGANDO...</div>
              :<PriceChart chartData={chartData} color={sel.color} indicators={indicators} tf={tf}/>
            }
            {indicators.rsi&&chartData?.length>14&&<><div style={{color:"#333",fontSize:10,letterSpacing:2,marginTop:8,marginBottom:4}}>RSI (14)</div><RSIChart prices={chartData.map(d=>d[1])}/></>}
            {indicators.macd&&chartData?.length>26&&<><div style={{color:"#333",fontSize:10,letterSpacing:2,marginTop:8,marginBottom:4}}>MACD</div><MACDChart prices={chartData.map(d=>d[1])}/></>}
          </>}
          {tab==="INDICADORES"&&<IndicatorsTab chartData={chartData} indicators={indicators} setIndicators={setInd}/>}
          {tab==="PORTFOLIO"&&<PortfolioTab prices={prices}/>}
          {tab==="ALERTAS"&&<AlertsTab prices={prices}/>}
          {tab==="NOTICIAS"&&<NewsTab newsBySymbol={news} loadingNews={loadingNews} activeSym={sel.id}/>}
          {tab==="IA"&&<AITab selected={sel} prices={prices} chartData={chartData} tf={tf}/>}
        </div>

        {/* FOOTER */}
        <div style={{borderTop:"1px solid #0c0c0c",padding:"5px 20px",display:"flex",gap:10,color:"#1e1e1e",fontSize:10,letterSpacing:1,flexShrink:0}}>
          <span>CHARTEX PRO</span><span>·</span><span style={{color:"#26a69a"}}>Finnhub Live</span><span>·</span><span>IA: Claude Sonnet</span>
          <span style={{marginLeft:"auto"}}>↻ 60s · tick #{tick}</span>
        </div>
      </div>
    </div>
  </div>);
}
