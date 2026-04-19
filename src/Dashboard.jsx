import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import * as d3 from "d3";

// ─── Constants ───
const QUADRANT_COLORS = { HH:"#ef4444", HL:"#f59e0b", LH:"#a78bfa", LL:"#34d399" };
const QUADRANT_LABELS = { HH:"双重困境", HL:"韧性缓冲", LH:"潜在脆弱", LL:"安全储备" };
const PHASE_COLORS = { "紧急":"#ef4444", "系统":"#f59e0b", "收尾":"#6b7280" };
const SUB_NAMES = ["经济韧性","社会韧性","基础设施韧性","生态韧性"];
const SUB_KEYS = ["econR","socR","infraR","ecoR"];
const SUB_COLORS = ["#f87171","#60a5fa","#34d399","#fbbf24"];

function lerp(a,b,t){ return a+(b-a)*Math.max(0,Math.min(1,t)); }
function v2c(val,scheme){
  const v=Math.max(0,Math.min(1,val));
  if(scheme==="res"){
    return `rgb(${Math.round(lerp(190,20,v))},${Math.round(lerp(60,170,v))},${Math.round(lerp(60,90,v))})`;
  }
  return `rgb(${Math.round(lerp(30,230,v))},${Math.round(lerp(100,55,v))},${Math.round(lerp(160,35,v))})`;
}

// ─── Main ───
export default function Dashboard(){
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState(null);
  const [ch,setCh]=useState(4);
  const [sel,setSel]=useState(null);
  const [hov,setHov]=useState(null);
  const [layer4,setLayer4]=useState("nfr");
  const [layer5,setLayer5]=useState("riskScore");
  const [layer6,setLayer6]=useState("recovery");
  const [step,setStep]=useState(0);
  const [playing,setPlaying]=useState(false);
  const [panelOpen,setPanelOpen]=useState(true);
  const timer=useRef(null);

  // Load data
  useEffect(()=>{
    fetch(import.meta.env.BASE_URL+'watershed_data.json')
      .then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json();})
      .then(json=>{
        const units=json.watersheds.map(u=>({
          ...u,
          weakest: u.weakestSubsystem>=0?u.weakestSubsystem
            :[u.econR,u.socR,u.infraR,u.ecoR].indexOf(Math.min(u.econR,u.socR,u.infraR,u.ecoR)),
        }));
        let rc=json.recoveryCurve||[];
        if(rc.length>50){const d=[rc[0]];for(let i=1;i<rc.length;i++){if(Math.abs(rc[i]-d[d.length-1])>0.0001)d.push(rc[i]);}rc=d;}
        while(rc.length<44)rc.push(rc[rc.length-1]||0.846);
        if(rc.length>44)rc=rc.slice(0,44);
        const aeldMax=Math.max(...units.map(u=>u.aeld));
        setData({units,rc,gc:json.greedyCurve||[],cities:json.cities||[],meta:json.meta,aeldMax});
        setLoading(false);
      })
      .catch(e=>{setError(e.message);setLoading(false);});
  },[]);

  // Animation
  useEffect(()=>{
    if(playing){timer.current=setInterval(()=>{setStep(p=>{if(p>=43){setPlaying(false);return 43;}return p+1;});},500);}
    return ()=>clearInterval(timer.current);
  },[playing]);

  // Voronoi computation
  const voronoi=useMemo(()=>{
    if(!data)return null;
    const pts=data.units.map(u=>[u.x,-u.y]);
    const pad=0.4;
    const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);
    const bounds=[Math.min(...xs)-pad,Math.min(...ys)-pad,Math.max(...xs)+pad,Math.max(...ys)+pad];
    const delaunay=d3.Delaunay.from(pts);
    const vor=delaunay.voronoi(bounds);
    return {vor,bounds};
  },[data]);

  // Recovery state
  const recState=useMemo(()=>{
    if(!data)return{repaired:new Set(),batch:[],curve:[0.49]};
    const sorted=[...data.units].sort((a,b)=>a.repairOrder-b.repairOrder);
    const repaired=new Set();
    const steps=[];
    for(let s=0;s<43;s++){
      sorted.slice(s*3,s*3+3).forEach(u=>repaired.add(u.id));
      steps.push(new Set(repaired));
    }
    const cur=step>0?steps[Math.min(step-1,42)]:new Set();
    const batch=step>0&&step<=43?sorted.slice((step-1)*3,(step-1)*3+3).map(u=>u.id):[];
    return{repaired:cur,batch,curve:data.rc};
  },[step,data]);

  // Color
  const getColor=useCallback((u)=>{
    if(!data)return"#333";
    if(ch===4){
      if(layer4==="weakest")return SUB_COLORS[u.weakest]||"#555";
      return v2c(u[layer4]||0,"res");
    }
    if(ch===5){
      if(layer5==="quadrant")return QUADRANT_COLORS[u.quadrant]||"#555";
      return v2c(u[layer5]||0,"risk");
    }
    if(ch===6){
      if(layer6==="phase")return PHASE_COLORS[u.repairPhase]||"#555";
      if(layer6==="recovery"){
        if(recState.batch.includes(u.id))return"#fbbf24";
        if(recState.repaired.has(u.id))return"#22c55e";
        return v2c(u.damage/0.6,"risk");
      }
      if(layer6==="aeld")return v2c(u.aeld/(data.aeldMax||103),"risk");
      if(layer6==="damage")return v2c(u.damage/0.6,"risk");
    }
    return"#555";
  },[ch,layer4,layer5,layer6,recState,data]);

  if(loading)return(
    <div style={{width:"100%",height:"100dvh",display:"flex",alignItems:"center",justifyContent:"center",
      background:"#080c14",color:"#64748b",fontFamily:"system-ui",flexDirection:"column",gap:16}}>
      <div style={{width:40,height:40,border:"3px solid #1e293b",borderTopColor:"#3b82f6",borderRadius:"50%",
        animation:"spin 0.8s linear infinite"}}/>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}@keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}`}</style>
      <div style={{fontSize:14,animation:"pulse 1.5s ease infinite"}}>加载京津冀洪涝韧性数据…</div>
    </div>
  );
  if(error)return(
    <div style={{width:"100%",height:"100dvh",display:"flex",alignItems:"center",justifyContent:"center",
      background:"#080c14",color:"#ef4444",fontFamily:"system-ui",flexDirection:"column",gap:8}}>
      <div style={{fontSize:16,fontWeight:700}}>数据加载失败</div>
      <div style={{fontSize:12,color:"#64748b"}}>{error}</div>
    </div>
  );

  const U=data.units;
  const disp=hov!==null?U.find(u=>u.id===hov):sel!==null?U.find(u=>u.id===sel):null;
  const [bx,by,bw0,bh0]=voronoi?voronoi.bounds:[113,-43,7,7];
  const bw=bw0-bx, bh=bh0-by;
  const cityGroups={};
  U.forEach(u=>{if(!cityGroups[u.cityName])cityGroups[u.cityName]=[];cityGroups[u.cityName].push(u);});

  return(
    <div style={{
      width:"100%",height:"100dvh",display:"flex",flexDirection:"column",overflow:"hidden",
      background:"#080c14",color:"#e2e8f0",fontFamily:"'Noto Sans SC',system-ui,sans-serif",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet"/>

      {/* ═══ HEADER ═══ */}
      <header style={{
        padding:"8px 16px",background:"rgba(8,12,20,0.95)",
        borderBottom:"1px solid rgba(255,255,255,0.06)",
        display:"flex",alignItems:"center",gap:12,flexShrink:0,
        backdropFilter:"blur(16px)",zIndex:10,flexWrap:"wrap",
      }}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginRight:8}}>
          <div style={{width:7,height:7,borderRadius:"50%",background:"#22c55e",boxShadow:"0 0 8px #22c55e"}}/>
          <span style={{fontSize:14,fontWeight:700,letterSpacing:0.5,whiteSpace:"nowrap"}}>京津冀洪涝韧性仪表盘</span>
        </div>
        <div style={{display:"flex",gap:2}}>
          {[{c:4,l:"灾前韧性"},{c:5,l:"风险耦合"},{c:6,l:"恢复优化"}].map(({c,l})=>(
            <button key={c} onClick={()=>{setCh(c);setStep(0);setPlaying(false);}} style={{
              padding:"5px 12px",border:"none",cursor:"pointer",borderRadius:4,fontSize:11,fontWeight:500,
              fontFamily:"inherit",transition:"all 0.15s",
              background:ch===c?"rgba(59,130,246,0.2)":"transparent",
              color:ch===c?"#93c5fd":"#64748b",
              outline:ch===c?"1px solid rgba(59,130,246,0.3)":"1px solid transparent",
            }}>Ch{c} {l}</button>
          ))}
        </div>
        <div style={{display:"flex",gap:3,alignItems:"center",marginLeft:"auto"}}>
          {["D","P","S","I","R"].map((d,i)=>(
            <span key={i} style={{
              fontSize:9,padding:"2px 5px",borderRadius:3,fontWeight:600,letterSpacing:0.5,
              background:(ch===4&&i===2)||(ch===5&&(i===1||i===3))||(ch===6&&i===4)
                ?"rgba(59,130,246,0.25)":"rgba(255,255,255,0.04)",
              color:(ch===4&&i===2)||(ch===5&&(i===1||i===3))||(ch===6&&i===4)
                ?"#93c5fd":"#475569",
            }}>{d}</span>
          ))}
        </div>
      </header>

      {/* ═══ BODY ═══ */}
      <div style={{flex:1,display:"flex",overflow:"hidden",position:"relative",minHeight:0}}>

        {/* ─── LEFT SIDEBAR ─── */}
        <div style={{
          width:170,minWidth:170,padding:"12px 10px",
          background:"rgba(8,12,20,0.7)",borderRight:"1px solid rgba(255,255,255,0.04)",
          display:"flex",flexDirection:"column",gap:8,overflowY:"auto",flexShrink:0,
        }}>
          <div style={{fontSize:9,color:"#475569",fontWeight:700,letterSpacing:1.5,textTransform:"uppercase"}}>图层</div>
          {ch===4&&<>
            <LG label="韧性" opts={[
              {k:"nfr",l:"综合NFR"},{k:"econR",l:"经济"},{k:"socR",l:"社会"},
              {k:"infraR",l:"基础设施"},{k:"ecoR",l:"生态"},{k:"weakest",l:"最弱子系统"},
            ]} v={layer4} set={setLayer4}/>
            {layer4!=="weakest"?<CB s="res"/>:
              <Legnd items={SUB_NAMES.map((n,i)=>({c:SUB_COLORS[i],l:n}))}/>}
          </>}
          {ch===5&&<>
            <LG label="风险" opts={[
              {k:"riskScore",l:"综合风险"},{k:"hazard",l:"H 危险性"},{k:"exposure",l:"E 暴露性"},
              {k:"sensitivity",l:"S 敏感性"},{k:"adaptability",l:"A 适应性"},{k:"quadrant",l:"四象限"},
            ]} v={layer5} set={setLayer5}/>
            {layer5!=="quadrant"?<CB s="risk"/>:
              <Legnd items={Object.entries(QUADRANT_LABELS).map(([k,v])=>({c:QUADRANT_COLORS[k],l:`${k} ${v}`}))}/>}
          </>}
          {ch===6&&<>
            <LG label="恢复" opts={[
              {k:"recovery",l:"修复动画"},{k:"aeld",l:"年期望经济损失"},
              {k:"damage",l:"初始损伤"},{k:"phase",l:"修复阶段"},
            ]} v={layer6} set={setLayer6}/>
            {layer6==="recovery"&&<Legnd items={[
              {c:"#fbbf24",l:"当前修复",g:true},{c:"#22c55e",l:"已修复"},{c:"#7f1d1d",l:"未修复"}]}/>}
            {layer6==="phase"&&<Legnd items={Object.entries(PHASE_COLORS).map(([k,v])=>({c:v,l:k}))}/>}
            {(layer6==="aeld"||layer6==="damage")&&<CB s="risk"/>}
          </>}
          <div style={{marginTop:"auto",paddingTop:8,borderTop:"1px solid rgba(255,255,255,0.04)",fontSize:9,color:"#334155",lineHeight:1.6}}>
            {data.meta.totalUnits} 汇水单元<br/>{data.meta.totalCities} 城市 · WGS84
          </div>
        </div>

        {/* ─── MAP ─── */}
        <div style={{flex:1,position:"relative",overflow:"hidden",background:"#0a0e17",minWidth:0}}>
          <svg viewBox={`${bx} ${by} ${bw} ${bh}`}
            preserveAspectRatio="xMidYMid meet"
            style={{width:"100%",height:"100%",display:"block"}}>
            <defs>
              <filter id="glow"><feGaussianBlur stdDeviation="0.03" result="b"/>
                <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
            </defs>

            {/* Voronoi cells */}
            {voronoi && U.map((u,i)=>{
              const cell=voronoi.vor.cellPolygon(i);
              if(!cell)return null;
              const color=getColor(u);
              const isSel=sel===u.id;
              const isHov=hov===u.id;
              const isBatch=ch===6&&layer6==="recovery"&&recState.batch.includes(u.id);
              const d="M"+cell.map(p=>p.join(",")).join("L")+"Z";
              return(
                <g key={u.id}>
                  <path d={d} fill={color} fillOpacity={isBatch?0.92:isSel?0.88:isHov?0.82:0.65}
                    stroke={isSel?"#fff":isHov?"rgba(255,255,255,0.5)":"rgba(0,0,0,0.4)"}
                    strokeWidth={isSel?0.025:isHov?0.015:0.008}
                    style={{cursor:"pointer",transition:"fill-opacity 0.15s, fill 0.25s"}}
                    onClick={()=>setSel(u.id===sel?null:u.id)}
                    onMouseEnter={()=>setHov(u.id)}
                    onMouseLeave={()=>setHov(null)}
                  />
                  <circle cx={u.x} cy={-u.y} r={isBatch?0.055:0.02}
                    fill={isBatch?"#fff":"rgba(255,255,255,0.25)"} style={{pointerEvents:"none"}}/>
                  {isBatch&&<circle cx={u.x} cy={-u.y} r={0.1} fill="none"
                    stroke="#fbbf24" strokeWidth={0.012} opacity={0.6} filter="url(#glow)">
                    <animate attributeName="r" values="0.06;0.14;0.06" dur="1s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" values="0.7;0.1;0.7" dur="1s" repeatCount="indefinite"/>
                  </circle>}
                  {isBatch&&<text x={u.x} y={-u.y+0.025} textAnchor="middle"
                    style={{fontSize:0.055,fill:"#000",fontWeight:700,fontFamily:"JetBrains Mono",pointerEvents:"none"}}>
                    {u.repairOrder+1}
                  </text>}
                </g>
              );
            })}

            {/* City labels */}
            {Object.entries(cityGroups).map(([name,units])=>{
              const cx=units.reduce((s,u)=>s+u.x,0)/units.length;
              const cy=units.reduce((s,u)=>s+u.y,0)/units.length;
              return(
                <text key={name} x={cx} y={-cy} textAnchor="middle" dominantBaseline="middle"
                  style={{fontSize:0.14,fill:"rgba(255,255,255,0.22)",fontWeight:700,
                    fontFamily:"'Noto Sans SC'",pointerEvents:"none",letterSpacing:0.02}}>
                  {name}
                </text>
              );
            })}
          </svg>

          {/* Chapter overlay */}
          <div style={{position:"absolute",top:10,left:12,fontSize:12,fontWeight:600,color:"rgba(148,163,184,0.6)",pointerEvents:"none"}}>
            {ch===4&&"第四章 · 灾前韧性基线"}{ch===5&&"第五章 · 洪涝风险时空格局"}{ch===6&&"第六章 · 灾后协同恢复优化"}
          </div>

          {/* Recovery controls */}
          {ch===6&&layer6==="recovery"&&(
            <div style={{
              position:"absolute",bottom:12,left:"50%",transform:"translateX(-50%)",
              display:"flex",alignItems:"center",gap:8,
              background:"rgba(8,12,20,0.92)",padding:"6px 14px",
              borderRadius:8,border:"1px solid rgba(255,255,255,0.06)",backdropFilter:"blur(12px)",
            }}>
              <MBtn onClick={()=>{setStep(0);setPlaying(false);}}>⏮</MBtn>
              <MBtn onClick={()=>setPlaying(!playing)}>{playing?"⏸":"▶"}</MBtn>
              <MBtn onClick={()=>setStep(s=>Math.min(s+1,43))}>⏭</MBtn>
              <input type="range" min={0} max={43} value={step}
                onChange={e=>{setStep(+e.target.value);setPlaying(false);}}
                style={{width:140,accentColor:"#3b82f6"}}/>
              <span style={{fontSize:11,fontFamily:"JetBrains Mono",color:"#93c5fd",minWidth:55}}>
                {step}/43
              </span>
              <span style={{fontSize:10,color:"#475569"}}>{recState.repaired.size}/129</span>
            </div>
          )}

          {/* Recovery curve */}
          {ch===6&&(
            <div style={{
              position:"absolute",bottom:layer6==="recovery"?56:12,right:12,
              width:240,height:130,background:"rgba(8,12,20,0.92)",padding:"8px 10px",
              borderRadius:8,border:"1px solid rgba(255,255,255,0.06)",
            }}>
              <div style={{fontSize:9,color:"#475569",marginBottom:3,fontWeight:600}}>F(t) · {data.meta.recoveryScenario}</div>
              <svg viewBox="0 0 220 100" style={{width:"100%",height:95}}>
                {[0.5,0.6,0.7,0.8].map(v=>(
                  <g key={v}>
                    <line x1={24} y1={100-v*110} x2={220} y2={100-v*110} stroke="rgba(255,255,255,0.06)" strokeWidth={0.5}/>
                    <text x={21} y={100-v*110+3} textAnchor="end" style={{fontSize:5.5,fill:"#334155"}}>{v.toFixed(1)}</text>
                  </g>
                ))}
                <line x1={24} y1={100-110} x2={220} y2={100-110} stroke="rgba(59,130,246,0.15)" strokeWidth={0.5} strokeDasharray="2,2"/>
                {data.gc.length>0&&<polyline fill="none" stroke="#334155" strokeWidth={0.8} strokeDasharray="2,1.5"
                  points={data.gc.map((v,i)=>`${24+i*(196/43)},${100-v*110}`).join(" ")}/>}
                <polyline fill="none" stroke="#3b82f6" strokeWidth={1.2}
                  points={recState.curve.slice(0,step+1).map((v,i)=>`${24+i*(196/43)},${100-v*110}`).join(" ")}/>
                {step>0&&<polygon opacity={0.08} fill="#3b82f6"
                  points={[...recState.curve.slice(0,step+1).map((v,i)=>`${24+i*(196/43)},${100-v*110}`),
                    `${24+step*(196/43)},${100-110}`,`24,${100-110}`].join(" ")}/>}
                {step>0&&<circle cx={24+step*(196/43)} cy={100-recState.curve[step]*110} r={2.5}
                  fill="#3b82f6" stroke="#fff" strokeWidth={0.8}/>}
                {step>0&&<text x={24+step*(196/43)} y={100-recState.curve[step]*110-5} textAnchor="middle"
                  style={{fontSize:6,fill:"#93c5fd",fontFamily:"JetBrains Mono"}}>{recState.curve[step]?.toFixed(4)}</text>}
                <text x={122} y={98} textAnchor="middle" style={{fontSize:5,fill:"#334155"}}>修复步 →</text>
                <line x1={160} y1={6} x2={172} y2={6} stroke="#3b82f6" strokeWidth={1.2}/>
                <text x={175} y={8} style={{fontSize:4.5,fill:"#64748b"}}>DRL</text>
                {data.gc.length>0&&<><line x1={190} y1={6} x2={202} y2={6} stroke="#334155" strokeWidth={0.8} strokeDasharray="2,1.5"/>
                <text x={205} y={8} style={{fontSize:4.5,fill:"#334155"}}>贪心</text></>}
              </svg>
            </div>
          )}

          {/* Stats */}
          {ch===4&&(
            <div style={{position:"absolute",bottom:12,right:12,display:"flex",flexDirection:"column",gap:4}}>
              {SUB_NAMES.map((n,i)=>{
                const avg=U.reduce((s,u)=>s+u[SUB_KEYS[i]],0)/U.length;
                const wk=U.filter(u=>u.weakest===i).length;
                return(<div key={i} style={{display:"flex",alignItems:"center",gap:6,
                  background:"rgba(8,12,20,0.88)",padding:"4px 10px",borderRadius:5,borderLeft:`3px solid ${SUB_COLORS[i]}`}}>
                  <span style={{fontSize:9,color:"#94a3b8",width:70}}>{n}</span>
                  <span style={{fontSize:11,fontFamily:"JetBrains Mono",color:"#e2e8f0",fontWeight:600,width:42}}>{avg.toFixed(3)}</span>
                  <span style={{fontSize:8,color:"#475569"}}>弱:{wk}</span>
                </div>);
              })}
            </div>
          )}
          {ch===5&&layer5==="quadrant"&&(
            <div style={{position:"absolute",bottom:12,right:12,background:"rgba(8,12,20,0.92)",padding:10,borderRadius:8}}>
              <div style={{fontSize:9,color:"#475569",marginBottom:4,fontWeight:600}}>四象限分布</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:3}}>
                {Object.entries(QUADRANT_LABELS).map(([k,v])=>(
                  <div key={k} style={{display:"flex",alignItems:"center",gap:5,padding:"3px 6px",borderRadius:3,
                    background:`${QUADRANT_COLORS[k]}12`}}>
                    <div style={{width:7,height:7,borderRadius:2,background:QUADRANT_COLORS[k]}}/>
                    <span style={{fontSize:9,color:"#cbd5e1"}}>{v}</span>
                    <span style={{fontSize:10,fontFamily:"JetBrains Mono",color:QUADRANT_COLORS[k],fontWeight:700,marginLeft:"auto"}}>
                      {U.filter(u=>u.quadrant===k).length}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ─── RIGHT PANEL ─── */}
        <div style={{
          width:panelOpen?230:0,minWidth:panelOpen?230:0,
          transition:"width 0.2s ease,min-width 0.2s ease",overflow:"hidden",
          background:"rgba(8,12,20,0.7)",borderLeft:"1px solid rgba(255,255,255,0.04)",flexShrink:0,
        }}>
          <div style={{width:230,padding:"12px 10px",overflowY:"auto",height:"100%",boxSizing:"border-box"}}>
            {disp?(
              <>
                <div style={{fontSize:9,color:"#475569",fontWeight:600,letterSpacing:1,marginBottom:6}}>汇水单元详情</div>
                <div style={{padding:"7px 9px",borderRadius:5,marginBottom:8,
                  background:"rgba(30,41,59,0.6)",border:"1px solid rgba(255,255,255,0.04)"}}>
                  <div style={{fontSize:13,fontWeight:700,color:"#e2e8f0"}}>{disp.cityName} · WS-{String(disp.wsId).padStart(3,"0")}</div>
                  <div style={{fontSize:9,color:"#475569",marginTop:1}}>{disp.x.toFixed(2)}°E, {disp.y.toFixed(2)}°N</div>
                </div>
                <Sec t="第四章 · 韧性基线" c="#3b82f6">
                  <Bar l="综合NFR" v={disp.nfr} c="#3b82f6"/>
                  <Bar l="网络NRI" v={disp.nri} c="#6366f1"/>
                  {SUB_NAMES.map((n,i)=>(<Bar key={i} l={n} v={disp[SUB_KEYS[i]]} c={SUB_COLORS[i]} w={disp.weakest===i}/>))}
                </Sec>
                <Sec t="第五章 · 洪涝风险" c="#ef4444">
                  <Bar l="综合风险" v={disp.riskScore} c="#ef4444"/>
                  <Bar l="H 危险性" v={disp.hazard} c="#dc2626"/>
                  <Bar l="E 暴露性" v={disp.exposure} c="#f97316"/>
                  <Bar l="S 敏感性" v={disp.sensitivity} c="#eab308"/>
                  <Bar l="A 适应性" v={disp.adaptability} c="#22c55e"/>
                  <div style={{display:"flex",alignItems:"center",gap:5,marginTop:3,padding:"3px 6px",borderRadius:3,
                    background:`${QUADRANT_COLORS[disp.quadrant]}15`}}>
                    <div style={{width:7,height:7,borderRadius:2,background:QUADRANT_COLORS[disp.quadrant]}}/>
                    <span style={{fontSize:9,color:"#cbd5e1"}}>{disp.quadrant} {QUADRANT_LABELS[disp.quadrant]}</span>
                    <span style={{fontSize:8,color:"#475569",marginLeft:"auto"}}>CCD={disp.couplingDegree?.toFixed(3)}</span>
                  </div>
                </Sec>
                <Sec t="第六章 · 恢复优化" c="#22c55e">
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:9,marginBottom:3}}>
                    <span style={{color:"#94a3b8"}}>修复序号</span>
                    <span style={{fontFamily:"JetBrains Mono",color:"#e2e8f0",fontWeight:600}}>#{disp.repairOrder+1}/129</span>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:9,marginBottom:3}}>
                    <span style={{color:"#94a3b8"}}>阶段</span>
                    <span style={{padding:"1px 5px",borderRadius:3,fontSize:8,fontWeight:600,
                      background:`${PHASE_COLORS[disp.repairPhase]}20`,color:PHASE_COLORS[disp.repairPhase]}}>
                      {disp.repairPhase}</span>
                  </div>
                  <Bar l="AELD(亿)" v={disp.aeld/(data.aeldMax||103)} c="#f59e0b" dv={disp.aeld.toFixed(1)}/>
                  <Bar l="枢纽权重" v={disp.hubWeight} c="#8b5cf6"/>
                  <Bar l="初始损伤" v={disp.damage} c="#ef4444"/>
                  <Bar l="淹没(m)" v={disp.inundDepth/1.5} c="#0ea5e9" dv={disp.inundDepth?.toFixed(3)}/>
                </Sec>
                {/* Radar */}
                <div style={{marginTop:8}}>
                  <div style={{fontSize:9,color:"#475569",fontWeight:600,marginBottom:4}}>四维韧性雷达</div>
                  <svg viewBox="0 0 120 120" style={{width:"100%"}}>
                    {[0.25,0.5,0.75,1].map(r=>(
                      <polygon key={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={0.5}
                        points={[0,1,2,3].map(i=>{const a=(i/4)*Math.PI*2-Math.PI/2;
                          return`${60+Math.cos(a)*r*42},${60+Math.sin(a)*r*42}`;}).join(" ")}/>
                    ))}
                    {SUB_NAMES.map((n,i)=>{const a=(i/4)*Math.PI*2-Math.PI/2;
                      return<text key={i} x={60+Math.cos(a)*52} y={60+Math.sin(a)*52}
                        textAnchor="middle" dominantBaseline="middle" style={{fontSize:5,fill:SUB_COLORS[i]}}>{n.replace("韧性","")}</text>;})}
                    <polygon fill="rgba(59,130,246,0.12)" stroke="#3b82f6" strokeWidth={0.8}
                      points={SUB_KEYS.map((k,i)=>{const a=(i/4)*Math.PI*2-Math.PI/2;
                        return`${60+Math.cos(a)*disp[k]*42},${60+Math.sin(a)*disp[k]*42}`;}).join(" ")}/>
                    {SUB_KEYS.map((k,i)=>{const a=(i/4)*Math.PI*2-Math.PI/2;
                      return<circle key={i} cx={60+Math.cos(a)*disp[k]*42} cy={60+Math.sin(a)*disp[k]*42}
                        r={2} fill={SUB_COLORS[i]} stroke="#fff" strokeWidth={0.4}/>;})}
                  </svg>
                </div>
              </>
            ):(
              <div style={{height:"100%",display:"flex",alignItems:"center",justifyContent:"center",
                flexDirection:"column",gap:6,color:"#334155",fontSize:10}}>
                <div style={{fontSize:22,opacity:0.2}}>◎</div><div>点击单元查看详情</div>
              </div>
            )}
          </div>
        </div>

        {/* Panel toggle */}
        <button onClick={()=>setPanelOpen(!panelOpen)} style={{
          position:"absolute",right:panelOpen?231:1,top:"50%",transform:"translateY(-50%)",
          zIndex:5,width:16,height:36,border:"none",borderRadius:panelOpen?"4px 0 0 4px":"0 4px 4px 0",
          background:"rgba(30,41,59,0.85)",color:"#64748b",cursor:"pointer",fontSize:9,
          display:"flex",alignItems:"center",justifyContent:"center",transition:"right 0.2s",
        }}>{panelOpen?"›":"‹"}</button>
      </div>
    </div>
  );
}

// ─── Sub-components ───
function LG({label,opts,v,set}){
  return(<div>
    <div style={{fontSize:9,color:"#64748b",fontWeight:500,marginBottom:3}}>{label}</div>
    <div style={{display:"flex",flexDirection:"column",gap:1}}>
      {opts.map(o=>(<button key={o.k} onClick={()=>set(o.k)} style={{
        padding:"3px 7px",border:"none",cursor:"pointer",borderRadius:3,fontSize:9.5,textAlign:"left",
        fontFamily:"inherit",transition:"all 0.12s",
        background:v===o.k?"rgba(59,130,246,0.18)":"transparent",
        color:v===o.k?"#93c5fd":"#535d6e",
      }}>{o.l}</button>))}
    </div>
  </div>);
}
function CB({s}){
  const g=s==="res"?"linear-gradient(to right,rgb(190,60,60),rgb(100,115,75),rgb(20,170,90))"
    :"linear-gradient(to right,rgb(30,100,160),rgb(130,78,98),rgb(230,55,35))";
  return(<div style={{marginTop:4}}>
    <div style={{height:5,borderRadius:3,background:g}}/>
    <div style={{display:"flex",justifyContent:"space-between",fontSize:8,color:"#334155",marginTop:1}}>
      <span>低</span><span>高</span>
    </div>
  </div>);
}
function Legnd({items}){
  return(<div style={{fontSize:9,display:"flex",flexDirection:"column",gap:2,marginTop:3}}>
    {items.map((it,i)=>(<div key={i} style={{display:"flex",alignItems:"center",gap:5}}>
      <div style={{width:8,height:8,borderRadius:it.g?"50%":2,background:it.c,
        boxShadow:it.g?`0 0 5px ${it.c}`:"none"}}/>
      <span style={{color:"#7a8599"}}>{it.l}</span>
    </div>))}
  </div>);
}
function Sec({t,c,children}){
  return(<div style={{marginBottom:8}}>
    <div style={{fontSize:9,fontWeight:600,color:c,marginBottom:4,paddingBottom:3,borderBottom:`1px solid ${c}25`}}>{t}</div>
    {children}
  </div>);
}
function Bar({l,v,c,w,dv}){
  return(<div style={{marginBottom:2}}>
    <div style={{display:"flex",justifyContent:"space-between",fontSize:9,marginBottom:1}}>
      <span style={{color:w?"#ef4444":"#7a8599"}}>{l}{w?" ⚠":""}</span>
      <span style={{fontFamily:"JetBrains Mono",fontSize:9,color:"#cbd5e1"}}>{dv||v?.toFixed(4)||"—"}</span>
    </div>
    <div style={{height:2.5,borderRadius:2,background:"rgba(255,255,255,0.04)"}}>
      <div style={{height:"100%",borderRadius:2,background:c,width:`${Math.min(v||0,1)*100}%`,transition:"width 0.25s"}}/>
    </div>
  </div>);
}
function MBtn({onClick,children}){
  return<button onClick={onClick} style={{
    padding:"3px 8px",border:"1px solid rgba(255,255,255,0.08)",borderRadius:4,
    background:"rgba(30,41,59,0.7)",color:"#e2e8f0",cursor:"pointer",fontSize:11,fontFamily:"inherit",
  }}>{children}</button>;
}
