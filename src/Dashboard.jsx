import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

// Mapbox token:本地从 .env.local 读,线上从 GitHub Actions secret 注入(VITE_MAPBOX_TOKEN)
mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || "";

// ─── Constants ───
const QUADRANT_COLORS = { HH:"#ef4444", HL:"#f59e0b", LH:"#a78bfa", LL:"#34d399" };
const QUADRANT_LABELS = { HH:"双重困境", HL:"韧性缓冲", LH:"潜在脆弱", LL:"安全储备" };
const PHASE_COLORS = { "紧急":"#ef4444", "系统":"#f59e0b", "收尾":"#6b7280" };
const SUB_NAMES = ["经济韧性","社会韧性","基础设施韧性","生态韧性"];
const SUB_KEYS = ["econR","socR","infraR","ecoR"];
const SUB_COLORS = ["#f87171","#60a5fa","#34d399","#fbbf24"];

// 可切换底图
const BASEMAPS = [
  {id:"dark",     label:"暗色",      style:"mapbox://styles/mapbox/dark-v11"},
  {id:"light",    label:"亮色",      style:"mapbox://styles/mapbox/light-v11"},
  {id:"sat",      label:"卫星",      style:"mapbox://styles/mapbox/satellite-v9"},
  {id:"satSt",    label:"卫星+标注", style:"mapbox://styles/mapbox/satellite-streets-v12"},
];

// 策略对比配色(第六章恢复曲线)
const STRATEGY_COLORS = {
  "DRL_dueling_ddqn": "#3b82f6",
  "greedy":           "#94a3b8",
  "ael":              "#f59e0b",
  "hub":              "#a78bfa",
  "nfr_priority":     "#22d3ee",
  "recovery_priority":"#ec4899",
};
const STRATEGY_LABELS = {
  "DRL_dueling_ddqn": "DRL",
  "greedy":           "贪心",
  "ael":              "AEL 优先",
  "hub":              "枢纽优先",
  "nfr_priority":     "NFR 优先",
  "recovery_priority":"恢复优先",
};
const SCENARIO_LABELS = {
  "HIST":      "历史",
  "SSP245":    "SSP2-4.5",
  "SSP245_CL": "SSP2-4.5+",
  "SSP585":    "SSP5-8.5",
  "SSP585_CL": "SSP5-8.5+",
};

// ── 5 级 Jenks 调色板（由原连续 lerp 在 t=0,0.25,0.5,0.75,1 采样得到） ──
const PAL_RES  = ["#be3c3c","#945844","#69734b","#3f8f53","#14aa5a"]; // 低(红) → 高(绿)
const PAL_RISK = ["#1e64a0","#505981","#824e62","#b44242","#e63723"]; // 低(蓝) → 高(红)

function classify(v, brks){
  if(!brks||brks.length<6||v==null||Number.isNaN(v))return 0;
  for(let i=4;i>=0;i--){ if(v>=brks[i])return i; }
  return 0;
}
function v2c(val, scheme, field, breaks){
  const pal = scheme==="res"?PAL_RES:PAL_RISK;
  if(field && breaks && breaks[field]){
    return pal[classify(val, breaks[field])];
  }
  // 回退:按 0-1 等分 5 段
  const i = Math.min(4, Math.max(0, Math.floor((val||0)*5)));
  return pal[i];
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
  const [mapReady,setMapReady]=useState(false);
  const [mapError,setMapError]=useState(null);
  const [showCities,setShowCities]=useState(false);
  const [showCounties,setShowCounties]=useState(false);
  const [showCountyLabels,setShowCountyLabels]=useState(false);
  const [showNetEdges,setShowNetEdges]=useState(false);
  const [basemap,setBasemap]=useState("dark");
  const [styleEpoch,setStyleEpoch]=useState(0);
  const [scenario,setScenario]=useState("SSP585");
  const [showAllStrategies,setShowAllStrategies]=useState(true);
  const timer=useRef(null);
  const mapContainer=useRef(null);
  const mapRef=useRef(null);
  const geoRef=useRef(null);
  const citiesGeoRef=useRef(null);
  const countiesGeoRef=useRef(null);
  const edgesGeoRef=useRef(null);
  const togglesRef=useRef({cities:false,counties:false,edges:false});
  const hovIdRef=useRef(null);
  const styleLoadedRef=useRef(false);

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
        const jenks=json.meta?.jenksBreaks||{};
        setData({units,rc,gc:json.greedyCurve||[],cities:json.cities||[],meta:json.meta,aeldMax,jenks});
        setLoading(false);
      })
      .catch(e=>{setError(e.message);setLoading(false);});
  },[]);

  // Animation
  useEffect(()=>{
    if(playing){timer.current=setInterval(()=>{setStep(p=>{if(p>=43){setPlaying(false);return 43;}return p+1;});},500);}
    return ()=>clearInterval(timer.current);
  },[playing]);


  // 归一化 F(t) 曲线到 44 步:去除连续重复 + 尾部填充 + 截断
  const normalizeCurve=(rc)=>{
    if(!rc||rc.length===0)return Array(44).fill(0.846);
    let r=[...rc];
    if(r.length>50){
      const d=[r[0]];
      for(let i=1;i<r.length;i++){ if(Math.abs(r[i]-d[d.length-1])>0.0001)d.push(r[i]); }
      r=d;
    }
    while(r.length<44)r.push(r[r.length-1]||0.846);
    if(r.length>44)r=r.slice(0,44);
    return r;
  };

  // 主恢复曲线(根据选中情景)
  const primaryCurve=useMemo(()=>{
    if(!data)return[];
    const key=`DRL_dueling_ddqn|${scenario}`;
    const raw=data.meta?.allCurves?.[key];
    return raw?normalizeCurve(raw):data.rc;
  },[data,scenario]);

  // 策略对比曲线(只有 SSP585 有 5 条基线策略)
  const comparisonCurves=useMemo(()=>{
    if(!data?.meta?.allCurves||scenario!=="SSP585")return[];
    const strats=["greedy","ael","hub","nfr_priority","recovery_priority"];
    return strats.map(s=>{
      const raw=data.meta.allCurves[`${s}|SSP585`];
      if(!raw)return null;
      return{strategy:s,curve:normalizeCurve(raw),color:STRATEGY_COLORS[s]};
    }).filter(Boolean);
  },[data,scenario]);

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
    return{repaired:cur,batch,curve:primaryCurve};
  },[step,data,primaryCurve]);

  // Color (Jenks 5-class)
  const getColor=useCallback((u)=>{
    if(!data)return"#333";
    const jb=data.jenks;
    if(ch===4){
      if(layer4==="weakest")return SUB_COLORS[u.weakest]||"#555";
      return v2c(u[layer4]||0,"res",layer4,jb);
    }
    if(ch===5){
      if(layer5==="quadrant")return QUADRANT_COLORS[u.quadrant]||"#555";
      return v2c(u[layer5]||0,"risk",layer5,jb);
    }
    if(ch===6){
      if(layer6==="phase")return PHASE_COLORS[u.repairPhase]||"#555";
      if(layer6==="recovery"){
        if(recState.batch.includes(u.id))return"#fbbf24";
        if(recState.repaired.has(u.id))return"#22c55e";
        return v2c(u.damage,"risk","damage",jb);
      }
      if(layer6==="aeld")       return v2c(u.aeld,"risk","aeld",jb);
      if(layer6==="damage")     return v2c(u.damage,"risk","damage",jb);
      if(layer6==="hubWeight")  return v2c(u.hubWeight,"risk","hubWeight",jb);
      if(layer6==="inundDepth") return v2c(u.inundDepth,"risk","inundDepth",jb);
      if(layer6==="roadDamage") return v2c(u.roadDamageRate,"risk","roadDamageRate",jb);
    }
    return"#555";
  },[ch,layer4,layer5,layer6,recState,data]);

  // ── toggles 实时同步到 ref(给 style.load 回调用,避免闭包陈旧) ──
  useEffect(()=>{
    togglesRef.current={cities:showCities,counties:showCounties,edges:showNetEdges};
  },[showCities,showCounties,showNetEdges]);

  // ── Mapbox init(data 就绪时只建一次) ──
  useEffect(()=>{
    if(!data||mapRef.current||!mapContainer.current)return;
    if(!mapboxgl.accessToken){ setMapError("缺少 Mapbox token"); return; }
    const initStyle=(BASEMAPS.find(b=>b.id===basemap)||BASEMAPS[0]).style;
    let map;
    try{
      map=new mapboxgl.Map({
        container:mapContainer.current,
        style:initStyle,
        center:[116.3,39.6],
        zoom:5.9,
        minZoom:4,
        maxZoom:11,
        attributionControl:false,
      });
    }catch(e){ setMapError(String(e.message||e)); return; }
    mapRef.current=map;
    // ── 注册所有监听器,在 Promise.all 之前,避免错过初始 style.load ──
    map.on("error",(e)=>{ if(e?.error?.status===401)setMapError("Mapbox token 无效(401)"); });

    // style.load 事件:初始 + 每次 setStyle 都会触发
    // 用 ref 精确跟踪 style 加载状态(比 isStyleLoaded() 更可靠)
    const tryAdd=()=>{
      const m=mapRef.current;
      if(!m||!geoRef.current||!styleLoadedRef.current)return false;
      addLayers(m);
      setStyleEpoch(e=>e+1);
      return true;
    };
    map.on("style.load",()=>{
      styleLoadedRef.current=true;
      tryAdd();
    });

    // 持久监听:直接挂在 map 上,不绑定到 layer id,存活于 setStyle
    map.on("mousemove",(e)=>{
      const feats=map.queryRenderedFeatures(e.point,{layers:["ws-fill"]});
      if(feats.length===0){
        if(hovIdRef.current!==null){
          map.setFeatureState({source:"ws",id:hovIdRef.current},{hover:false});
          hovIdRef.current=null;
        }
        map.getCanvas().style.cursor="";
        setHov(null);
        return;
      }
      const f=feats[0];
      if(hovIdRef.current!==null&&hovIdRef.current!==f.id){
        map.setFeatureState({source:"ws",id:hovIdRef.current},{hover:false});
      }
      hovIdRef.current=f.id;
      map.setFeatureState({source:"ws",id:f.id},{hover:true});
      map.getCanvas().style.cursor="pointer";
      setHov(f.properties.id-1);
    });
    map.on("click",(e)=>{
      const feats=map.queryRenderedFeatures(e.point,{layers:["ws-fill"]});
      if(feats.length===0)return;
      const idZero=feats[0].properties.id-1;
      setSel(prev=>prev===idZero?null:idZero);
    });

    // 并行拉取所有 geojson,缓存到 ref(仅做一次)
    const base=import.meta.env.BASE_URL;
    const pFetch=(f)=>fetch(base+f).then(r=>r.ok?r.json():Promise.reject(r.status)).catch(e=>{console.warn(f+"加载失败:",e);return null;});
    Promise.all([
      pFetch("watersheds.geojson"),
      pFetch("cities.geojson"),
      pFetch("counties.geojson"),
      pFetch("city_edges_g1.geojson"),
    ]).then(([ws,cs,cn,eg])=>{
      if(!ws){ setMapError("watersheds.geojson 加载失败"); return; }
      ws.features.forEach(f=>{
        const u=data.units.find(x=>x.wsId===f.properties.id);
        f.properties._color=u?"#666":"#444";
      });
      geoRef.current=ws;
      citiesGeoRef.current=cs;
      countiesGeoRef.current=cn;
      edgesGeoRef.current=eg;
      // 如果 style 已就绪,立即加图层;否则 style.load 回调会在它到达时自动触发 tryAdd
      tryAdd();
      setMapReady(true);
    });

    return()=>{ map.remove(); mapRef.current=null; styleLoadedRef.current=false; setMapReady(false); };
  },[data]);

  // ── 内部辅助:把所有自定义 source/layer 加回当前 style(幂等) ──
  function addLayers(map){
    const ws=geoRef.current; if(!ws)return;
    if(!map.getSource("ws")){
      map.addSource("ws",{type:"geojson",data:ws,promoteId:"id"});
      map.addLayer({
        id:"ws-fill",type:"fill",source:"ws",
        paint:{
          "fill-color":["get","_color"],
          "fill-opacity":["case",
            ["boolean",["feature-state","selected"],false],0.92,
            ["boolean",["feature-state","hover"],false],0.82,
            0.62,
          ],
        },
      });
      map.addLayer({
        id:"ws-line",type:"line",source:"ws",
        paint:{
          "line-color":["case",
            ["boolean",["feature-state","selected"],false],"#ffffff",
            ["boolean",["feature-state","hover"],false],"rgba(255,255,255,0.65)",
            "rgba(255,255,255,0.22)",
          ],
          "line-width":["case",
            ["boolean",["feature-state","selected"],false],2.2,
            ["boolean",["feature-state","hover"],false],1.4,
            0.5,
          ],
        },
      });
    }
    const tog=togglesRef.current;
    if(citiesGeoRef.current&&!map.getSource("cities")){
      map.addSource("cities",{type:"geojson",data:citiesGeoRef.current});
      map.addLayer({id:"cities-line",type:"line",source:"cities",
        layout:{visibility:tog.cities?"visible":"none"},
        paint:{"line-color":"#fbbf24","line-width":1.8,"line-opacity":0.85}});
    }
    if(countiesGeoRef.current&&!map.getSource("counties")){
      map.addSource("counties",{type:"geojson",data:countiesGeoRef.current});
      map.addLayer({id:"counties-line",type:"line",source:"counties",
        layout:{visibility:tog.counties?"visible":"none"},
        paint:{"line-color":"rgba(56,189,248,0.75)","line-width":0.9,"line-dasharray":[2,2]}});
    }
    if(edgesGeoRef.current&&!map.getSource("net-edges")){
      map.addSource("net-edges",{type:"geojson",data:edgesGeoRef.current});
      map.addLayer({id:"net-edges-line",type:"line",source:"net-edges",
        layout:{visibility:tog.edges?"visible":"none","line-cap":"round"},
        paint:{
          "line-color":["match",["get","cls"],1,"#64748b",2,"#3b82f6",3,"#8b5cf6",4,"#ec4899",5,"#ef4444","#94a3b8"],
          "line-width":["interpolate",["linear"],["get","w"],0,0.6,1,4.0],
          "line-opacity":0.75,
        }});
    }
  }

  // ── 底图切换 ──
  useEffect(()=>{
    const map=mapRef.current;
    if(!map)return;
    const entry=BASEMAPS.find(b=>b.id===basemap);
    if(entry)map.setStyle(entry.style);
  },[basemap]);

  // ── 颜色刷新:图层/步骤改变时重算每个 feature._color 并 setData ──
  useEffect(()=>{
    const map=mapRef.current;
    const geo=geoRef.current;
    if(!map||!mapReady||!data||!geo)return;
    const src=map.getSource("ws");
    if(!src)return;
    geo.features.forEach(f=>{
      const u=data.units.find(x=>x.wsId===f.properties.id);
      f.properties._color=u?getColor(u):"#444";
    });
    src.setData(geo);
  },[getColor,data,mapReady,styleEpoch]);

  // ── 行政叠加可见性同步(依赖 styleEpoch 确保切底图后重应用) ──
  useEffect(()=>{
    const map=mapRef.current;
    if(!map||!mapReady||!map.getLayer("cities-line"))return;
    map.setLayoutProperty("cities-line","visibility",showCities?"visible":"none");
  },[showCities,mapReady,styleEpoch]);
  useEffect(()=>{
    const map=mapRef.current;
    if(!map||!mapReady||!map.getLayer("counties-line"))return;
    map.setLayoutProperty("counties-line","visibility",showCounties?"visible":"none");
  },[showCounties,mapReady,styleEpoch]);
  useEffect(()=>{
    const map=mapRef.current;
    if(!map||!mapReady||!map.getLayer("net-edges-line"))return;
    map.setLayoutProperty("net-edges-line","visibility",showNetEdges?"visible":"none");
  },[showNetEdges,mapReady,styleEpoch]);

  // ── 选中同步:sel 变化时更新 feature-state.selected ──
  useEffect(()=>{
    const map=mapRef.current;
    if(!map||!mapReady||!data||!map.getSource("ws"))return;
    data.units.forEach(u=>{
      map.setFeatureState({source:"ws",id:u.wsId},{selected:false});
    });
    if(sel!=null&&data.units[sel]){
      map.setFeatureState({source:"ws",id:data.units[sel].wsId},{selected:true});
    }
  },[sel,data,mapReady,styleEpoch]);

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
        <div style={{display:"flex",alignItems:"center",gap:10,marginRight:8}}>
          <div style={{width:8,height:8,borderRadius:"50%",background:"#22c55e",boxShadow:"0 0 8px #22c55e"}}/>
          <span style={{fontSize:16,fontWeight:700,letterSpacing:0.5,whiteSpace:"nowrap"}}>京津冀洪涝韧性仪表盘</span>
        </div>
        <div style={{display:"flex",gap:3}}>
          {[{c:4,l:"灾前韧性"},{c:5,l:"风险耦合"},{c:6,l:"恢复优化"}].map(({c,l})=>(
            <button key={c} onClick={()=>{setCh(c);setStep(0);setPlaying(false);}} style={{
              padding:"6px 14px",border:"none",cursor:"pointer",borderRadius:5,fontSize:13,fontWeight:500,
              fontFamily:"inherit",transition:"all 0.15s",
              background:ch===c?"rgba(59,130,246,0.2)":"transparent",
              color:ch===c?"#93c5fd":"#94a3b8",
              outline:ch===c?"1px solid rgba(59,130,246,0.3)":"1px solid transparent",
            }}>Ch{c} {l}</button>
          ))}
        </div>
        <div style={{display:"flex",gap:4,alignItems:"center",marginLeft:"auto"}}>
          {["D","P","S","I","R"].map((d,i)=>(
            <span key={i} style={{
              fontSize:11,padding:"3px 7px",borderRadius:3,fontWeight:600,letterSpacing:0.5,
              background:(ch===4&&i===2)||(ch===5&&(i===1||i===3))||(ch===6&&i===4)
                ?"rgba(59,130,246,0.25)":"rgba(255,255,255,0.04)",
              color:(ch===4&&i===2)||(ch===5&&(i===1||i===3))||(ch===6&&i===4)
                ?"#93c5fd":"#64748b",
            }}>{d}</span>
          ))}
        </div>
      </header>

      {/* ═══ BODY ═══ */}
      <div style={{flex:1,display:"flex",overflow:"hidden",position:"relative",minHeight:0}}>

        {/* ─── LEFT SIDEBAR ─── */}
        <div style={{
          width:210,minWidth:210,padding:"14px 12px",
          background:"rgba(8,12,20,0.7)",borderRight:"1px solid rgba(255,255,255,0.04)",
          display:"flex",flexDirection:"column",gap:10,overflowY:"auto",flexShrink:0,
        }}>
          <div style={{fontSize:11,color:"#64748b",fontWeight:700,letterSpacing:1.5,textTransform:"uppercase"}}>图层</div>
          {ch===4&&<>
            <LG label="韧性" opts={[
              {k:"baseline",l:"综合韧性基线"},{k:"nfr",l:"节点功能韧性"},{k:"nri",l:"网络联系韧性"},
              {k:"econR",l:"经济"},{k:"socR",l:"社会"},{k:"infraR",l:"基础设施"},{k:"ecoR",l:"生态"},
              {k:"weakest",l:"最弱子系统"},
            ]} v={layer4} set={setLayer4}/>
            {layer4!=="weakest"?<CB s="res" field={layer4} breaks={data.jenks}/>:
              <Legnd items={SUB_NAMES.map((n,i)=>({c:SUB_COLORS[i],l:n}))}/>}
          </>}
          {ch===5&&<>
            <LG label="风险" opts={[
              {k:"riskScore",l:"综合风险"},{k:"hazard",l:"H 危险性"},{k:"exposure",l:"E 暴露性"},
              {k:"sensitivity",l:"S 敏感性"},{k:"adaptability",l:"A 适应性"},{k:"quadrant",l:"四象限"},
            ]} v={layer5} set={setLayer5}/>
            {layer5!=="quadrant"?<CB s="risk" field={layer5} breaks={data.jenks}/>:
              <Legnd items={Object.entries(QUADRANT_LABELS).map(([k,v])=>({c:QUADRANT_COLORS[k],l:`${k} ${v}`}))}/>}
          </>}
          {ch===6&&<>
            <LG label="恢复" opts={[
              {k:"recovery",l:"修复动画"},{k:"phase",l:"修复阶段"},
              {k:"aeld",l:"年期望经济损失"},{k:"damage",l:"初始损伤"},
              {k:"hubWeight",l:"三层网络枢纽权重"},{k:"inundDepth",l:"百年一遇淹没深度"},
              {k:"roadDamage",l:"道路损伤率"},
            ]} v={layer6} set={setLayer6}/>
            {layer6==="recovery"&&<Legnd items={[
              {c:"#fbbf24",l:"当前修复",g:true},{c:"#22c55e",l:"已修复"},{c:"#7f1d1d",l:"未修复"}]}/>}
            {layer6==="phase"&&<Legnd items={Object.entries(PHASE_COLORS).map(([k,v])=>({c:v,l:k}))}/>}
            {(layer6==="aeld"||layer6==="damage"||layer6==="hubWeight"||layer6==="inundDepth")
              &&<CB s="risk" field={layer6==="hubWeight"?"hubWeight":layer6==="inundDepth"?"inundDepth":layer6} breaks={data.jenks}/>}
            {layer6==="roadDamage"&&<CB s="risk" field="roadDamageRate" breaks={data.jenks}/>}
          </>}
          {/* 行政叠加切换 */}
          <div style={{marginTop:8,paddingTop:10,borderTop:"1px solid rgba(255,255,255,0.04)"}}>
            <div style={{fontSize:11,color:"#64748b",fontWeight:700,letterSpacing:1.5,textTransform:"uppercase",marginBottom:6}}>行政叠加</div>
            <Toggle label="城市边界(13)" color="#fbbf24" on={showCities} set={setShowCities}/>
            <Toggle label="区县边界(199)" color="#38bdf8" on={showCounties} set={setShowCounties} dashed/>
            <Toggle label="区县名称(199)" color="#38bdf8" on={showCountyLabels} set={setShowCountyLabels}/>
            {ch===4&&<Toggle label="城市网络边(78)" color="#ec4899" on={showNetEdges} set={setShowNetEdges}/>}
          </div>

          <div style={{marginTop:"auto",paddingTop:10,borderTop:"1px solid rgba(255,255,255,0.04)",fontSize:11,color:"#475569",lineHeight:1.6}}>
            {data.meta.totalUnits} 汇水单元<br/>{data.meta.totalCities} 城市 · Mapbox 底图<br/>
            <span style={{fontSize:10,color:"#334155"}}>Jenks · 5 分级</span>
          </div>
        </div>

        {/* ─── MAP ─── */}
        <div style={{flex:1,position:"relative",overflow:"hidden",background:"#0a0e17",minWidth:0}}>
          {/* Mapbox 容器 */}
          <div ref={mapContainer} style={{position:"absolute",inset:0}}/>

          {/* 底图加载失败提示 */}
          {mapError&&(
            <div style={{position:"absolute",top:42,left:14,padding:"4px 9px",borderRadius:4,
              background:"rgba(127,29,29,0.7)",color:"#fecaca",fontSize:11,pointerEvents:"none",
              border:"1px solid rgba(239,68,68,0.35)"}}>
              底图不可用:{mapError}(仍可查看汇水单元)
            </div>
          )}

          {/* 城市名 HTML 叠加(Mapbox 原生文字缺 CJK 字形,改用 DOM 覆盖) */}
          <CityLabels map={mapRef.current} ready={mapReady} cityGroups={cityGroups}/>

          {/* 区县名称 HTML 叠加 — 仅当 showCountyLabels 为 true 时绘制,且 zoom>=7 避免远景密密麻麻 */}
          <CountyLabels map={mapRef.current} ready={mapReady} show={showCountyLabels}/>

          {/* Chapter overlay */}
          <div style={{position:"absolute",top:12,left:14,fontSize:15,fontWeight:600,color:"rgba(148,163,184,0.72)",pointerEvents:"none",letterSpacing:0.5}}>
            {ch===4&&"第四章 · 灾前韧性基线"}{ch===5&&"第五章 · 洪涝风险时空格局"}{ch===6&&"第六章 · 灾后协同恢复优化"}
          </div>

          {/* 底图切换 */}
          <div style={{position:"absolute",top:10,right:14,display:"flex",gap:2,
            background:"rgba(8,12,20,0.85)",padding:3,borderRadius:6,
            border:"1px solid rgba(255,255,255,0.08)",backdropFilter:"blur(8px)"}}>
            {BASEMAPS.map(b=>(
              <button key={b.id} onClick={()=>setBasemap(b.id)} style={{
                padding:"4px 9px",border:"none",borderRadius:4,cursor:"pointer",
                fontSize:11,fontFamily:"inherit",fontWeight:500,
                background:basemap===b.id?"rgba(59,130,246,0.28)":"transparent",
                color:basemap===b.id?"#bfdbfe":"#94a3b8",
                transition:"all 0.12s",
              }}>{b.label}</button>
            ))}
          </div>

          {/* Recovery controls */}
          {ch===6&&layer6==="recovery"&&(
            <div style={{
              position:"absolute",bottom:14,left:"50%",transform:"translateX(-50%)",
              display:"flex",alignItems:"center",gap:10,
              background:"rgba(8,12,20,0.92)",padding:"8px 18px",
              borderRadius:10,border:"1px solid rgba(255,255,255,0.08)",backdropFilter:"blur(12px)",
            }}>
              <MBtn onClick={()=>{setStep(0);setPlaying(false);}}>⏮</MBtn>
              <MBtn onClick={()=>setPlaying(!playing)}>{playing?"⏸":"▶"}</MBtn>
              <MBtn onClick={()=>setStep(s=>Math.min(s+1,43))}>⏭</MBtn>
              <input type="range" min={0} max={43} value={step}
                onChange={e=>{setStep(+e.target.value);setPlaying(false);}}
                style={{width:160,accentColor:"#3b82f6"}}/>
              <span style={{fontSize:13,fontFamily:"JetBrains Mono",color:"#93c5fd",minWidth:60,fontWeight:600}}>
                {step}/43
              </span>
              <span style={{fontSize:12,color:"#64748b"}}>{recState.repaired.size}/129</span>
            </div>
          )}

          {/* Recovery curve + 情景切换 + 策略对比 */}
          {ch===6&&(
            <div style={{
              position:"absolute",bottom:layer6==="recovery"?56:12,right:12,
              width:340,background:"rgba(8,12,20,0.92)",padding:"10px 12px",
              borderRadius:8,border:"1px solid rgba(255,255,255,0.08)",
            }}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                <div style={{fontSize:12,color:"#93c5fd",fontWeight:600,letterSpacing:0.3}}>恢复曲线</div>
                <div style={{fontSize:10,color:"#475569",fontFamily:"JetBrains Mono"}}>F(t) · {SCENARIO_LABELS[scenario]||scenario}</div>
              </div>
              {/* 情景切换 */}
              <div style={{display:"flex",gap:2,marginBottom:5,flexWrap:"wrap"}}>
                {["HIST","SSP245","SSP245_CL","SSP585","SSP585_CL"].map(sc=>(
                  <button key={sc} onClick={()=>setScenario(sc)} style={{
                    padding:"3px 7px",border:"none",borderRadius:3,cursor:"pointer",
                    fontSize:10,fontFamily:"inherit",fontWeight:500,flex:1,
                    background:scenario===sc?"rgba(59,130,246,0.25)":"rgba(255,255,255,0.04)",
                    color:scenario===sc?"#bfdbfe":"#64748b",
                    transition:"all 0.12s",
                  }}>{SCENARIO_LABELS[sc]}</button>
                ))}
              </div>
              <svg viewBox="0 0 220 100" style={{width:"100%",height:110,display:"block"}}>
                {[0.5,0.6,0.7,0.8,0.9].map(v=>(
                  <g key={v}>
                    <line x1={24} y1={100-v*110} x2={220} y2={100-v*110} stroke="rgba(255,255,255,0.06)" strokeWidth={0.5}/>
                    <text x={21} y={100-v*110+3} textAnchor="end" style={{fontSize:5.5,fill:"#334155"}}>{v.toFixed(1)}</text>
                  </g>
                ))}
                <line x1={24} y1={100-110} x2={220} y2={100-110} stroke="rgba(59,130,246,0.15)" strokeWidth={0.5} strokeDasharray="2,2"/>
                {/* 策略对比(仅 SSP585 且开关打开):5 条基线策略 */}
                {scenario==="SSP585"&&showAllStrategies&&comparisonCurves.map(cc=>(
                  <polyline key={cc.strategy} fill="none" stroke={cc.color} strokeWidth={0.7} strokeDasharray="2,1.5" opacity={0.75}
                    points={cc.curve.map((v,i)=>`${24+i*(196/43)},${100-v*110}`).join(" ")}/>
                ))}
                {/* 主曲线:DRL 在所选情景下 */}
                <polyline fill="none" stroke={STRATEGY_COLORS.DRL_dueling_ddqn} strokeWidth={1.4}
                  points={recState.curve.slice(0,step+1).map((v,i)=>`${24+i*(196/43)},${100-v*110}`).join(" ")}/>
                {step>0&&<polygon opacity={0.08} fill="#3b82f6"
                  points={[...recState.curve.slice(0,step+1).map((v,i)=>`${24+i*(196/43)},${100-v*110}`),
                    `${24+step*(196/43)},${100-110}`,`24,${100-110}`].join(" ")}/>}
                {step>0&&<circle cx={24+step*(196/43)} cy={100-recState.curve[step]*110} r={2.5}
                  fill="#3b82f6" stroke="#fff" strokeWidth={0.8}/>}
                {step>0&&<text x={24+step*(196/43)} y={100-recState.curve[step]*110-5} textAnchor="middle"
                  style={{fontSize:6,fill:"#93c5fd",fontFamily:"JetBrains Mono"}}>{recState.curve[step]?.toFixed(4)}</text>}
                <text x={122} y={98} textAnchor="middle" style={{fontSize:5,fill:"#334155"}}>修复步 →</text>
              </svg>
              {/* 策略图例 + 对比开关 */}
              {scenario==="SSP585"?(
                <div style={{display:"flex",flexWrap:"wrap",gap:"3px 9px",fontSize:9.5,marginTop:4,alignItems:"center"}}>
                  <button onClick={()=>setShowAllStrategies(v=>!v)} style={{
                    padding:"2px 6px",border:"1px solid rgba(255,255,255,0.1)",borderRadius:3,cursor:"pointer",
                    fontFamily:"inherit",fontSize:9,fontWeight:600,
                    background:showAllStrategies?"rgba(59,130,246,0.2)":"transparent",
                    color:showAllStrategies?"#bfdbfe":"#64748b",
                  }}>策略对比 {showAllStrategies?"✓":"×"}</button>
                  {Object.entries(STRATEGY_LABELS).map(([k,l])=>{
                    const isDRL=k==="DRL_dueling_ddqn";
                    const active=isDRL||showAllStrategies;
                    return(
                      <span key={k} style={{display:"inline-flex",alignItems:"center",gap:4,opacity:active?1:0.3}}>
                        <span style={{display:"inline-block",width:14,borderTop:`${isDRL?"1.5px solid":"1px dashed"} ${STRATEGY_COLORS[k]}`}}/>
                        <span style={{color:isDRL?"#bfdbfe":"#94a3b8"}}>{l}</span>
                      </span>
                    );
                  })}
                </div>
              ):(
                <div style={{fontSize:9.5,color:"#64748b",marginTop:4,fontStyle:"italic"}}>
                  仅 SSP5-8.5 有完整策略对比数据;当前显示 DRL 单曲线
                </div>
              )}
            </div>
          )}

          {/* Stats */}
          {ch===4&&(
            <div style={{position:"absolute",bottom:14,right:14,display:"flex",flexDirection:"column",gap:5}}>
              {SUB_NAMES.map((n,i)=>{
                const avg=U.reduce((s,u)=>s+u[SUB_KEYS[i]],0)/U.length;
                const wk=U.filter(u=>u.weakest===i).length;
                return(<div key={i} style={{display:"flex",alignItems:"center",gap:8,
                  background:"rgba(8,12,20,0.9)",padding:"6px 12px",borderRadius:6,borderLeft:`4px solid ${SUB_COLORS[i]}`}}>
                  <span style={{fontSize:12,color:"#cbd5e1",width:84}}>{n}</span>
                  <span style={{fontSize:13,fontFamily:"JetBrains Mono",color:"#e2e8f0",fontWeight:600,width:48}}>{avg.toFixed(3)}</span>
                  <span style={{fontSize:11,color:"#64748b"}}>弱:{wk}</span>
                </div>);
              })}
            </div>
          )}
          {ch===5&&layer5==="quadrant"&&(
            <div style={{position:"absolute",bottom:14,right:14,background:"rgba(8,12,20,0.92)",padding:12,borderRadius:8,border:"1px solid rgba(255,255,255,0.06)"}}>
              <div style={{fontSize:11,color:"#64748b",marginBottom:6,fontWeight:600,letterSpacing:0.5}}>四象限分布</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5}}>
                {Object.entries(QUADRANT_LABELS).map(([k,v])=>(
                  <div key={k} style={{display:"flex",alignItems:"center",gap:6,padding:"4px 8px",borderRadius:4,
                    background:`${QUADRANT_COLORS[k]}12`}}>
                    <div style={{width:9,height:9,borderRadius:2,background:QUADRANT_COLORS[k]}}/>
                    <span style={{fontSize:11,color:"#cbd5e1"}}>{v}</span>
                    <span style={{fontSize:12,fontFamily:"JetBrains Mono",color:QUADRANT_COLORS[k],fontWeight:700,marginLeft:"auto"}}>
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
          width:panelOpen?280:0,minWidth:panelOpen?280:0,
          transition:"width 0.2s ease,min-width 0.2s ease",overflow:"hidden",
          background:"rgba(8,12,20,0.7)",borderLeft:"1px solid rgba(255,255,255,0.04)",flexShrink:0,
        }}>
          <div style={{width:280,padding:"14px 12px",overflowY:"auto",height:"100%",boxSizing:"border-box"}}>
            {disp?(
              <>
                <div style={{fontSize:11,color:"#64748b",fontWeight:600,letterSpacing:1,marginBottom:8}}>汇水单元详情</div>
                <div style={{padding:"9px 11px",borderRadius:6,marginBottom:10,
                  background:"rgba(30,41,59,0.6)",border:"1px solid rgba(255,255,255,0.04)"}}>
                  <div style={{fontSize:15,fontWeight:700,color:"#e2e8f0"}}>{disp.cityName} · WS-{String(disp.wsId).padStart(3,"0")}</div>
                  <div style={{fontSize:11,color:"#64748b",marginTop:2}}>{disp.x.toFixed(2)}°E, {disp.y.toFixed(2)}°N</div>
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
                  <div style={{display:"flex",alignItems:"center",gap:6,marginTop:5,padding:"4px 8px",borderRadius:4,
                    background:`${QUADRANT_COLORS[disp.quadrant]}15`}}>
                    <div style={{width:9,height:9,borderRadius:2,background:QUADRANT_COLORS[disp.quadrant]}}/>
                    <span style={{fontSize:11,color:"#cbd5e1"}}>{disp.quadrant} {QUADRANT_LABELS[disp.quadrant]}</span>
                    <span style={{fontSize:10,color:"#475569",marginLeft:"auto"}}>CCD={disp.couplingDegree?.toFixed(3)}</span>
                  </div>
                </Sec>
                <Sec t="第六章 · 恢复优化" c="#22c55e">
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:4}}>
                    <span style={{color:"#94a3b8"}}>修复序号</span>
                    <span style={{fontFamily:"JetBrains Mono",color:"#e2e8f0",fontWeight:600}}>#{disp.repairOrder+1}/129</span>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:4}}>
                    <span style={{color:"#94a3b8"}}>阶段</span>
                    <span style={{padding:"2px 7px",borderRadius:3,fontSize:10,fontWeight:600,
                      background:`${PHASE_COLORS[disp.repairPhase]}20`,color:PHASE_COLORS[disp.repairPhase]}}>
                      {disp.repairPhase}</span>
                  </div>
                  <Bar l="AELD(亿)" v={disp.aeld/(data.aeldMax||103)} c="#f59e0b" dv={disp.aeld.toFixed(1)}/>
                  <Bar l="枢纽权重" v={disp.hubWeight} c="#8b5cf6"/>
                  <Bar l="初始损伤" v={disp.damage} c="#ef4444"/>
                  <Bar l="淹没(m)" v={disp.inundDepth/1.5} c="#0ea5e9" dv={disp.inundDepth?.toFixed(3)}/>
                </Sec>
                {/* Radar */}
                <div style={{marginTop:10}}>
                  <div style={{fontSize:11,color:"#64748b",fontWeight:600,marginBottom:6}}>四维韧性雷达</div>
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
                flexDirection:"column",gap:8,color:"#475569",fontSize:12}}>
                <div style={{fontSize:28,opacity:0.2}}>◎</div><div>点击单元查看详情</div>
              </div>
            )}
          </div>
        </div>

        {/* Panel toggle */}
        <button onClick={()=>setPanelOpen(!panelOpen)} style={{
          position:"absolute",right:panelOpen?281:1,top:"50%",transform:"translateY(-50%)",
          zIndex:5,width:18,height:44,border:"none",borderRadius:panelOpen?"5px 0 0 5px":"0 5px 5px 0",
          background:"rgba(30,41,59,0.85)",color:"#94a3b8",cursor:"pointer",fontSize:12,
          display:"flex",alignItems:"center",justifyContent:"center",transition:"right 0.2s",
        }}>{panelOpen?"›":"‹"}</button>
      </div>
    </div>
  );
}

// ─── Sub-components ───
// 城市名 HTML 叠加层:根据 Mapbox 相机位置将 WGS84 坐标投到屏幕像素
function CityLabels({map,ready,cityGroups}){
  const [, force] = useState(0);
  useEffect(()=>{
    if(!map||!ready)return;
    const upd = ()=>force(v=>v+1);
    map.on("move",upd);
    map.on("zoom",upd);
    upd();
    return ()=>{ map.off("move",upd); map.off("zoom",upd); };
  },[map,ready]);
  if(!map||!ready)return null;
  return (
    <div style={{position:"absolute",inset:0,pointerEvents:"none",zIndex:2}}>
      {Object.entries(cityGroups).map(([name,units])=>{
        const lng = units.reduce((s,u)=>s+u.x,0)/units.length;
        const lat = units.reduce((s,u)=>s+u.y,0)/units.length;
        const p = map.project([lng,lat]);
        return(
          <div key={name} style={{
            position:"absolute",left:p.x,top:p.y,transform:"translate(-50%,-50%)",
            fontSize:15,fontWeight:700,color:"rgba(255,255,255,0.35)",letterSpacing:1,
            textShadow:"0 0 6px rgba(0,0,0,0.9), 0 0 3px rgba(0,0,0,0.9)",
            fontFamily:"'Noto Sans SC',sans-serif",whiteSpace:"nowrap",
          }}>{name}</div>
        );
      })}
    </div>
  );
}

// 区县名称 HTML 叠加,独立加载 counties_labels.geojson(199 个质心点),缩放低时隐藏避免拥挤
function CountyLabels({map,ready,show}){
  const [pts,setPts]=useState(null);
  const [, force]=useState(0);
  useEffect(()=>{
    if(!show||pts)return;
    fetch(import.meta.env.BASE_URL+"counties_labels.geojson").then(r=>r.json())
      .then(g=>setPts(g.features.map(f=>({
        name:f.properties.name,
        city:f.properties.city,
        lng:f.geometry.coordinates[0],
        lat:f.geometry.coordinates[1],
      }))))
      .catch(e=>console.warn("counties_labels 加载失败:",e));
  },[show,pts]);
  useEffect(()=>{
    if(!map||!ready)return;
    const upd=()=>force(v=>v+1);
    map.on("move",upd); map.on("zoom",upd); upd();
    return()=>{ map.off("move",upd); map.off("zoom",upd); };
  },[map,ready]);
  if(!map||!ready||!show||!pts)return null;
  const zoom=map.getZoom();
  if(zoom<7)return null; // 低缩放不画,避免 199 个标签叠一团
  const opacity=Math.min(1,(zoom-7)/1.5); // zoom 7→0, 8.5+→全显
  return(
    <div style={{position:"absolute",inset:0,pointerEvents:"none",zIndex:2}}>
      {pts.map((p,i)=>{
        const pt=map.project([p.lng,p.lat]);
        return(
          <div key={i} style={{
            position:"absolute",left:pt.x,top:pt.y,transform:"translate(-50%,-50%)",
            fontSize:10,fontWeight:500,color:`rgba(186,230,253,${opacity*0.85})`,
            textShadow:"0 0 4px rgba(0,0,0,0.9),0 0 2px rgba(0,0,0,0.9)",
            fontFamily:"'Noto Sans SC',sans-serif",whiteSpace:"nowrap",letterSpacing:0.3,
          }}>{p.name}</div>
        );
      })}
    </div>
  );
}

// 行政叠加开关
function Toggle({label,color,on,set,dashed}){
  return(
    <button onClick={()=>set(!on)} style={{
      display:"flex",alignItems:"center",gap:9,width:"100%",
      padding:"6px 9px",border:"none",borderRadius:4,cursor:"pointer",
      fontFamily:"inherit",fontSize:12,textAlign:"left",marginBottom:3,
      background:on?"rgba(59,130,246,0.15)":"transparent",
      color:on?"#e2e8f0":"#94a3b8",transition:"all 0.12s",
    }}>
      <span style={{
        display:"inline-block",width:18,height:0,
        borderTop:on?`${dashed?"1.5px dashed":"2px solid"} ${color}`:"1.5px solid rgba(255,255,255,0.15)",
        boxShadow:on?`0 0 4px ${color}`:"none",
      }}/>
      {label}
    </button>
  );
}

function LG({label,opts,v,set}){
  return(<div>
    <div style={{fontSize:11,color:"#7a8599",fontWeight:500,marginBottom:4}}>{label}</div>
    <div style={{display:"flex",flexDirection:"column",gap:2}}>
      {opts.map(o=>(<button key={o.k} onClick={()=>set(o.k)} style={{
        padding:"5px 10px",border:"none",cursor:"pointer",borderRadius:4,fontSize:12,textAlign:"left",
        fontFamily:"inherit",transition:"all 0.12s",
        background:v===o.k?"rgba(59,130,246,0.18)":"transparent",
        color:v===o.k?"#93c5fd":"#94a3b8",
      }}>{o.l}</button>))}
    </div>
  </div>);
}
// 5 级 Jenks 图例:显示 5 个离散色块,可选展示分级阈值
function CB({s,field,breaks}){
  const pal = s==="res"?["#be3c3c","#945844","#69734b","#3f8f53","#14aa5a"]
                       :["#1e64a0","#505981","#824e62","#b44242","#e63723"];
  const brks = field && breaks ? breaks[field] : null;
  return(<div style={{marginTop:6}}>
    <div style={{display:"flex",height:10,borderRadius:3,overflow:"hidden"}}>
      {pal.map((c,i)=>(<div key={i} style={{flex:1,background:c}}/>))}
    </div>
    {brks && brks.length===6 ? (
      <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#475569",marginTop:3,fontFamily:"JetBrains Mono"}}>
        {brks.map((b,i)=>(<span key={i}>{b>=100?b.toFixed(0):b.toFixed(2)}</span>))}
      </div>
    ) : (
      <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"#475569",marginTop:3}}>
        <span>低</span><span>高</span>
      </div>
    )}
    <div style={{fontSize:9,color:"#334155",marginTop:2}}>Jenks · 5 分级</div>
  </div>);
}
function Legnd({items}){
  return(<div style={{fontSize:11,display:"flex",flexDirection:"column",gap:4,marginTop:4}}>
    {items.map((it,i)=>(<div key={i} style={{display:"flex",alignItems:"center",gap:7}}>
      <div style={{width:10,height:10,borderRadius:it.g?"50%":2,background:it.c,
        boxShadow:it.g?`0 0 6px ${it.c}`:"none"}}/>
      <span style={{color:"#94a3b8"}}>{it.l}</span>
    </div>))}
  </div>);
}
function Sec({t,c,children}){
  return(<div style={{marginBottom:10}}>
    <div style={{fontSize:12,fontWeight:600,color:c,marginBottom:6,paddingBottom:4,borderBottom:`1px solid ${c}25`,letterSpacing:0.3}}>{t}</div>
    {children}
  </div>);
}
function Bar({l,v,c,w,dv}){
  return(<div style={{marginBottom:4}}>
    <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:2}}>
      <span style={{color:w?"#ef4444":"#94a3b8"}}>{l}{w?" ⚠":""}</span>
      <span style={{fontFamily:"JetBrains Mono",fontSize:11,color:"#e2e8f0",fontWeight:500}}>{dv||v?.toFixed(4)||"—"}</span>
    </div>
    <div style={{height:3,borderRadius:2,background:"rgba(255,255,255,0.05)"}}>
      <div style={{height:"100%",borderRadius:2,background:c,width:`${Math.min(v||0,1)*100}%`,transition:"width 0.25s"}}/>
    </div>
  </div>);
}
function MBtn({onClick,children}){
  return<button onClick={onClick} style={{
    padding:"5px 11px",border:"1px solid rgba(255,255,255,0.1)",borderRadius:5,
    background:"rgba(30,41,59,0.8)",color:"#e2e8f0",cursor:"pointer",fontSize:13,fontFamily:"inherit",
  }}>{children}</button>;
}
