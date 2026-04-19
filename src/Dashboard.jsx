import { useState, useEffect, useCallback, useMemo, useRef } from "react";

// ─── Color Scales ───
function lerp(a, b, t) { return a + (b - a) * Math.max(0, Math.min(1, t)); }

function valueToColor(val, scheme = "viridis") {
  const v = Math.max(0, Math.min(1, val));
  if (scheme === "resilience") {
    const r = Math.round(lerp(220, 30, v));
    const g = Math.round(lerp(50, 170, v));
    const b = Math.round(lerp(50, 100, v));
    return `rgb(${r},${g},${b})`;
  }
  if (scheme === "risk") {
    const r = Math.round(lerp(40, 220, v));
    const g = Math.round(lerp(120, 60, v));
    const b = Math.round(lerp(180, 40, v));
    return `rgb(${r},${g},${b})`;
  }
  if (scheme === "recovery") {
    const r = Math.round(lerp(80, 20, v));
    const g = Math.round(lerp(80, 200, v));
    const b = Math.round(lerp(120, 100, v));
    return `rgb(${r},${g},${b})`;
  }
  return `rgb(${Math.round(v*255)},${Math.round(v*200)},${Math.round((1-v)*255)})`;
}

const QUADRANT_COLORS = {
  HH: "#DC2626", HL: "#F59E0B", LH: "#8B5CF6", LL: "#10B981",
};
const QUADRANT_LABELS = {
  HH: "双重困境", HL: "韧性缓冲", LH: "潜在脆弱", LL: "安全储备",
};
const PHASE_COLORS = { "紧急": "#EF4444", "系统": "#F59E0B", "收尾": "#6B7280" };
const SUBSYSTEM_NAMES = ["经济韧性", "社会韧性", "基础设施韧性", "生态韧性"];
const SUBSYSTEM_KEYS = ["econR", "socR", "infraR", "ecoR"];
const SUBSYSTEM_COLORS = ["#E63946", "#457B9D", "#2A9D8F", "#E9C46A"];

const CITY_COLORS = {
  "北京":"#E63946","天津":"#457B9D","石家庄":"#2A9D8F","唐山":"#E9C46A",
  "保定":"#F4A261","廊坊":"#264653","沧州":"#E76F51","衡水":"#606C38",
  "邢台":"#BC6C25","邯郸":"#DDA15E","张家口":"#588157","承德":"#3A5A40",
  "秦皇岛":"#A8DADC",
};

// ─── Main Component ───
export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [chapter, setChapter] = useState(4);
  const [selectedUnit, setSelectedUnit] = useState(null);
  const [ch4Layer, setCh4Layer] = useState("nfr");
  const [ch5Layer, setCh5Layer] = useState("riskScore");
  const [ch6Layer, setCh6Layer] = useState("recovery");
  const [recoveryStep, setRecoveryStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hoveredUnit, setHoveredUnit] = useState(null);
  const timerRef = useRef(null);

  // ─── Load real data ───
  useEffect(() => {
    fetch(import.meta.env.BASE_URL + 'watershed_data.json')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(json => {
        const units = json.watersheds.map(u => ({
          ...u,
          weakest: u.weakestSubsystem >= 0 ? u.weakestSubsystem
            : [u.econR, u.socR, u.infraR, u.ecoR].indexOf(
                Math.min(u.econR, u.socR, u.infraR, u.ecoR)),
        }));

        // Deduplicate recovery curve (88→44 steps)
        let rc = json.recoveryCurve || [];
        if (rc.length > 50) {
          const deduped = [rc[0]];
          for (let i = 1; i < rc.length; i++) {
            if (Math.abs(rc[i] - deduped[deduped.length - 1]) > 0.0001) {
              deduped.push(rc[i]);
            }
          }
          rc = deduped;
        }
        // Ensure exactly 44 points (step 0-43)
        while (rc.length < 44) rc.push(rc[rc.length - 1] || 0.846);
        if (rc.length > 44) rc = rc.slice(0, 44);

        // Same for greedy
        let gc = json.greedyCurve || [];

        // Compute AELD max for color scaling
        const aeldMax = Math.max(...units.map(u => u.aeld));

        setData({ units, recoveryCurve: rc, greedyCurve: gc, cities: json.cities || [], meta: json.meta, aeldMax });
        setLoading(false);
      })
      .catch(err => {
        console.error('数据加载失败:', err);
        setError(err.message);
        setLoading(false);
      });
  }, []);

  // Recovery animation
  useEffect(() => {
    if (isPlaying) {
      timerRef.current = setInterval(() => {
        setRecoveryStep(prev => {
          if (prev >= 43) { setIsPlaying(false); return 43; }
          return prev + 1;
        });
      }, 600);
    }
    return () => clearInterval(timerRef.current);
  }, [isPlaying]);

  // Compute recovery state
  const recoveryState = useMemo(() => {
    if (!data) return { currentRepaired: new Set(), currentBatch: [], curve: [0.491] };
    const sorted = [...data.units].sort((a, b) => a.repairOrder - b.repairOrder);
    const repaired = new Set();
    const steps = [];

    for (let s = 0; s < 43; s++) {
      const batch = sorted.slice(s * 3, s * 3 + 3);
      batch.forEach(u => repaired.add(u.id));
      steps.push(new Set(repaired));
    }

    const currentRepaired = recoveryStep > 0 ? steps[Math.min(recoveryStep - 1, 42)] : new Set();
    const currentBatch = recoveryStep > 0 && recoveryStep <= 43
      ? sorted.slice((recoveryStep - 1) * 3, (recoveryStep - 1) * 3 + 3).map(u => u.id)
      : [];

    return { currentRepaired, currentBatch, curve: data.recoveryCurve };
  }, [recoveryStep, data]);

  const getUnitColor = useCallback((unit) => {
    if (!data) return "#666";
    if (chapter === 4) {
      if (ch4Layer === "weakest") return SUBSYSTEM_COLORS[unit.weakest] || "#666";
      return valueToColor(unit[ch4Layer] || 0, "resilience");
    }
    if (chapter === 5) {
      if (ch5Layer === "quadrant") return QUADRANT_COLORS[unit.quadrant] || "#666";
      return valueToColor(unit[ch5Layer] || 0, "risk");
    }
    if (chapter === 6) {
      if (ch6Layer === "phase") return PHASE_COLORS[unit.repairPhase] || "#666";
      if (ch6Layer === "recovery") {
        if (recoveryState.currentBatch.includes(unit.id)) return "#FBBF24";
        if (recoveryState.currentRepaired.has(unit.id)) return "#10B981";
        return valueToColor(unit.damage, "risk");
      }
      if (ch6Layer === "aeld") return valueToColor(unit.aeld / (data.aeldMax || 103), "risk");
      if (ch6Layer === "damage") return valueToColor(unit.damage / 0.6, "risk");
    }
    return "#666";
  }, [chapter, ch4Layer, ch5Layer, ch6Layer, recoveryState, data]);

  // ─── Loading / Error ───
  if (loading) return (
    <div style={{ width:"100%",height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",
      background:"#0a0e17",color:"#64748B",fontFamily:"'Noto Sans SC',sans-serif",flexDirection:"column",gap:12 }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;700&display=swap" rel="stylesheet" />
      <div style={{width:32,height:32,border:"3px solid #1e293b",borderTop:"3px solid #3B82F6",borderRadius:"50%",
        animation:"spin 1s linear infinite"}} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{fontSize:13}}>加载京津冀洪涝韧性数据...</div>
    </div>
  );
  if (error) return (
    <div style={{ width:"100%",height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",
      background:"#0a0e17",color:"#EF4444",fontFamily:"sans-serif",flexDirection:"column",gap:8 }}>
      <div style={{fontSize:15,fontWeight:600}}>数据加载失败</div>
      <div style={{fontSize:12,color:"#64748B"}}>{error}</div>
      <div style={{fontSize:11,color:"#475569",marginTop:8}}>请确认 public/watershed_data.json 文件存在</div>
    </div>
  );

  const UNITS = data.units;
  const displayUnit = hoveredUnit !== null ? UNITS.find(u => u.id === hoveredUnit)
    : selectedUnit !== null ? UNITS.find(u => u.id === selectedUnit) : null;

  // Map bounds (WGS84 lon/lat) — SVG uses lon as X, invert lat for Y
  const pad = 0.3;
  const lons = UNITS.map(u => u.x);
  const lats = UNITS.map(u => u.y);
  const minLon = Math.min(...lons) - pad;
  const maxLon = Math.max(...lons) + pad;
  const minLat = Math.min(...lats) - pad;
  const maxLat = Math.max(...lats) + pad;
  // SVG viewBox: x=lon, y=-lat (flip), width=lonRange, height=latRange
  const vbX = minLon;
  const vbY = -maxLat;
  const vbW = maxLon - minLon;
  const vbH = maxLat - minLat;

  // Group units by city for labels
  const cityGroups = {};
  UNITS.forEach(u => {
    if (!cityGroups[u.cityName]) cityGroups[u.cityName] = [];
    cityGroups[u.cityName].push(u);
  });

  return (
    <div style={{
      width: "100%", minHeight: "100vh",
      background: "linear-gradient(135deg, #0a0e17 0%, #111827 50%, #0f172a 100%)",
      color: "#e2e8f0", fontFamily: "'Noto Sans SC', 'SF Pro Display', sans-serif",
      display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />

      {/* ─── Header ─── */}
      <header style={{
        padding: "12px 20px", background: "rgba(15,23,42,0.9)",
        borderBottom: "1px solid rgba(100,116,139,0.2)",
        display: "flex", alignItems: "center", gap: 16, backdropFilter: "blur(12px)",
        flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width:8,height:8,borderRadius:"50%",background:"#10B981",boxShadow:"0 0 8px #10B981" }} />
          <span style={{ fontSize:15,fontWeight:700,letterSpacing:1 }}>京津冀城市群洪涝韧性全过程仪表盘</span>
          <span style={{ fontSize:10,color:"#475569",background:"rgba(16,185,129,0.15)",padding:"2px 6px",borderRadius:3 }}>真实数据</span>
        </div>
        <div style={{ display: "flex", gap: 2, marginLeft: "auto" }}>
          {[
            { ch:4, label:"灾前韧性基线", icon:"◆" },
            { ch:5, label:"灾中风险耦合", icon:"▲" },
            { ch:6, label:"灾后恢复优化", icon:"●" },
          ].map(({ ch, label, icon }) => (
            <button key={ch} onClick={() => { setChapter(ch); setRecoveryStep(0); setIsPlaying(false); }}
              style={{
                padding:"6px 14px",border:"none",cursor:"pointer",borderRadius:4,fontSize:12,fontWeight:500,
                fontFamily:"inherit",
                background: chapter===ch ? "rgba(59,130,246,0.25)" : "transparent",
                color: chapter===ch ? "#60A5FA" : "#94A3B8",
                border: chapter===ch ? "1px solid rgba(59,130,246,0.4)" : "1px solid transparent",
                transition:"all 0.2s",
              }}>
              <span style={{marginRight:4}}>{icon}</span>第{ch}章 {label}
            </button>
          ))}
        </div>
        <div style={{ display:"flex",gap:4,alignItems:"center",marginLeft:12 }}>
          {["D 驱动力","P 压力","S 状态","I 影响","R 响应"].map((label,i) => (
            <span key={i} style={{display:"flex",alignItems:"center",gap:4}}>
              <span style={{
                fontSize:9,padding:"2px 5px",borderRadius:3,
                background:(chapter===4&&i===2)||(chapter===5&&(i===1||i===3))||(chapter===6&&i===4)
                  ? "rgba(59,130,246,0.3)":"rgba(51,65,85,0.5)",
                color:(chapter===4&&i===2)||(chapter===5&&(i===1||i===3))||(chapter===6&&i===4)
                  ? "#93C5FD":"#64748B",
                fontWeight:500,
              }}>{label}</span>
              {i < 4 && <span style={{color:"#334155",fontSize:8}}>→</span>}
            </span>
          ))}
        </div>
      </header>

      {/* ─── Main Content ─── */}
      <div style={{ flex:1, display:"flex", overflow:"hidden" }}>

        {/* ─── Left: Layer Controls ─── */}
        <div style={{
          width:180,padding:"14px 12px",background:"rgba(15,23,42,0.6)",
          borderRight:"1px solid rgba(100,116,139,0.15)",
          display:"flex",flexDirection:"column",gap:10,overflowY:"auto",
        }}>
          <div style={{fontSize:10,color:"#64748B",fontWeight:600,letterSpacing:1,textTransform:"uppercase"}}>
            图层控制
          </div>
          {chapter===4 && <>
            <LayerGroup label="韧性维度" options={[
              {key:"nfr",label:"综合NFR"},{key:"econR",label:"经济韧性"},
              {key:"socR",label:"社会韧性"},{key:"infraR",label:"基础设施韧性"},
              {key:"ecoR",label:"生态韧性"},{key:"weakest",label:"最弱子系统"},
            ]} value={ch4Layer} onChange={setCh4Layer} />
            {ch4Layer !== "weakest" && <ColorBar scheme="resilience" label={["低","高"]} />}
            {ch4Layer === "weakest" && <Legend items={SUBSYSTEM_NAMES.map((n,i) => ({color:SUBSYSTEM_COLORS[i],label:n}))} />}
          </>}
          {chapter===5 && <>
            <LayerGroup label="风险维度" options={[
              {key:"riskScore",label:"综合风险"},{key:"hazard",label:"H 危险性"},
              {key:"exposure",label:"E 暴露性"},{key:"sensitivity",label:"S 敏感性"},
              {key:"adaptability",label:"A 适应性"},{key:"quadrant",label:"四象限耦合"},
            ]} value={ch5Layer} onChange={setCh5Layer} />
            {ch5Layer !== "quadrant" && <ColorBar scheme="risk" label={["低","高"]} />}
            {ch5Layer === "quadrant" && <Legend items={Object.entries(QUADRANT_LABELS).map(([k,v]) => ({color:QUADRANT_COLORS[k],label:`${k} ${v}`}))} />}
          </>}
          {chapter===6 && <>
            <LayerGroup label="恢复维度" options={[
              {key:"recovery",label:"修复动画"},{key:"aeld",label:"年期望经济损失"},
              {key:"damage",label:"初始损伤"},{key:"phase",label:"修复阶段"},
            ]} value={ch6Layer} onChange={setCh6Layer} />
            {ch6Layer === "recovery" && <Legend items={[
              {color:"#FBBF24",label:"当前修复",glow:true},{color:"#10B981",label:"已修复"},{color:"#7F1D1D",label:"未修复"},
            ]} />}
            {ch6Layer === "phase" && <Legend items={Object.entries(PHASE_COLORS).map(([k,v]) => ({color:v,label:k+"阶段"}))} />}
            {(ch6Layer === "aeld" || ch6Layer === "damage") && <ColorBar scheme="risk" label={["低","高"]} />}
          </>}
          <div style={{
            marginTop:"auto",padding:"8px 0",borderTop:"1px solid rgba(100,116,139,0.15)",
            fontSize:10,color:"#475569",
          }}>
            <div>空间单元: {data.meta.totalUnits} 汇水单元</div>
            <div>城市: {data.meta.totalCities} 地级市</div>
            <div>网格: {data.meta.totalGrids?.toLocaleString()} (1km²)</div>
            <div style={{marginTop:4,color:"#334155"}}>CRS: WGS84</div>
          </div>
        </div>

        {/* ─── Center: Map ─── */}
        <div style={{ flex:1, position:"relative", overflow:"hidden" }}>
          <svg viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
            style={{ width:"100%",height:"100%",display:"block" }}>

            {/* City labels */}
            {Object.entries(cityGroups).map(([name, units]) => {
              const cx = units.reduce((s,u) => s + u.x, 0) / units.length;
              const cy = units.reduce((s,u) => s + u.y, 0) / units.length;
              return (
                <text key={`cl-${name}`} x={cx} y={-cy - 0.25} textAnchor="middle"
                  style={{fontSize:0.12,fill:"rgba(148,163,184,0.45)",fontWeight:500,
                    fontFamily:"'Noto Sans SC'",pointerEvents:"none"}}>
                  {name}
                </text>
              );
            })}

            {/* Watershed units */}
            {UNITS.map(unit => {
              const color = getUnitColor(unit);
              const isSelected = selectedUnit === unit.id;
              const isHovered = hoveredUnit === unit.id;
              const isBatch = chapter===6 && ch6Layer==="recovery" && recoveryState.currentBatch.includes(unit.id);
              const r = isBatch ? 0.11 : isSelected ? 0.1 : isHovered ? 0.095 : 0.075;
              return (
                <g key={unit.id}>
                  {isBatch && (
                    <circle cx={unit.x} cy={-unit.y} r={0.16} fill="none"
                      stroke="#FBBF24" strokeWidth={0.012} opacity={0.5}>
                      <animate attributeName="r" values="0.11;0.18;0.11" dur="1.2s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.6;0.15;0.6" dur="1.2s" repeatCount="indefinite" />
                    </circle>
                  )}
                  <circle cx={unit.x} cy={-unit.y} r={r} fill={color}
                    stroke={isSelected?"#fff":isHovered?"rgba(255,255,255,0.6)":"rgba(0,0,0,0.3)"}
                    strokeWidth={isSelected?0.016:0.006}
                    style={{cursor:"pointer",transition:"fill 0.3s"}}
                    onClick={() => setSelectedUnit(unit.id === selectedUnit ? null : unit.id)}
                    onMouseEnter={() => setHoveredUnit(unit.id)}
                    onMouseLeave={() => setHoveredUnit(null)}
                  />
                  {isBatch && (
                    <text x={unit.x} y={-unit.y + 0.03} textAnchor="middle"
                      style={{fontSize:0.055,fill:"#000",fontWeight:700,fontFamily:"JetBrains Mono",pointerEvents:"none"}}>
                      {unit.repairOrder + 1}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {/* Chapter title overlay */}
          <div style={{position:"absolute",top:12,left:16,fontSize:13,fontWeight:600,color:"#94A3B8"}}>
            {chapter===4 && "第四章 · 灾前韧性基线的双维评估与融合诊断"}
            {chapter===5 && "第五章 · 洪涝风险的时空格局与耦合驱动机制"}
            {chapter===6 && "第六章 · 灾后协同恢复优化与差异化策略"}
          </div>

          {/* Recovery Controls (Ch6) */}
          {chapter===6 && ch6Layer==="recovery" && (
            <div style={{
              position:"absolute",bottom:16,left:"50%",transform:"translateX(-50%)",
              display:"flex",alignItems:"center",gap:10,
              background:"rgba(15,23,42,0.9)",padding:"8px 16px",
              borderRadius:8,border:"1px solid rgba(100,116,139,0.2)",backdropFilter:"blur(8px)",
            }}>
              <button onClick={() => {setRecoveryStep(0);setIsPlaying(false);}} style={btnStyle}>⏮</button>
              <button onClick={() => setIsPlaying(!isPlaying)} style={btnStyle}>{isPlaying?"⏸":"▶"}</button>
              <button onClick={() => setRecoveryStep(s=>Math.min(s+1,43))} style={btnStyle}>⏭</button>
              <input type="range" min={0} max={43} value={recoveryStep}
                onChange={e=>{setRecoveryStep(+e.target.value);setIsPlaying(false);}}
                style={{width:200,accentColor:"#3B82F6"}} />
              <span style={{fontSize:12,fontFamily:"JetBrains Mono",color:"#93C5FD",minWidth:80}}>
                Step {recoveryStep}/43
              </span>
              <span style={{fontSize:11,color:"#64748B"}}>
                已修复: {recoveryState.currentRepaired.size}/129
              </span>
            </div>
          )}

          {/* Recovery Curve (Ch6) */}
          {chapter===6 && (
            <div style={{
              position:"absolute",bottom:ch6Layer==="recovery"?64:16,right:16,
              width:280,height:150,
              background:"rgba(15,23,42,0.9)",padding:"10px 12px",
              borderRadius:8,border:"1px solid rgba(100,116,139,0.2)",
            }}>
              <div style={{fontSize:10,color:"#64748B",marginBottom:4,fontWeight:600}}>
                系统功能保留率 F(t) · {data.meta.recoveryScenario}
              </div>
              <svg viewBox="0 0 260 110" style={{width:"100%",height:108}}>
                {[0.5,0.6,0.7,0.8].map(v => (
                  <g key={v}>
                    <line x1={28} y1={110-v*120} x2={260} y2={110-v*120}
                      stroke="rgba(100,116,139,0.15)" strokeWidth={0.5} />
                    <text x={25} y={110-v*120+3} textAnchor="end"
                      style={{fontSize:6,fill:"#475569"}}>{v.toFixed(1)}</text>
                  </g>
                ))}
                <line x1={28} y1={110-1.0*120} x2={260} y2={110-1.0*120}
                  stroke="rgba(59,130,246,0.3)" strokeWidth={0.5} strokeDasharray="3,3" />

                {/* Greedy baseline */}
                {data.greedyCurve.length > 0 && (
                  <polyline fill="none" stroke="#64748B" strokeWidth={1} strokeDasharray="3,2" opacity={0.5}
                    points={data.greedyCurve.map((v,i) =>
                      `${28+i*(232/43)},${110-v*120}`).join(" ")} />
                )}

                {/* DRL curve */}
                <polyline fill="none" stroke="#3B82F6" strokeWidth={1.5}
                  points={recoveryState.curve.slice(0,recoveryStep+1).map((v,i) =>
                    `${28+i*(232/43)},${110-v*120}`).join(" ")} />

                {/* LoR shaded area */}
                {recoveryStep > 0 && (
                  <polygon opacity={0.1} fill="#3B82F6"
                    points={[
                      ...recoveryState.curve.slice(0,recoveryStep+1).map((v,i) =>
                        `${28+i*(232/43)},${110-v*120}`),
                      `${28+recoveryStep*(232/43)},${110-1.0*120}`,
                      `28,${110-1.0*120}`,
                    ].join(" ")} />
                )}

                {recoveryStep > 0 && (
                  <circle cx={28+recoveryStep*(232/43)}
                    cy={110-recoveryState.curve[recoveryStep]*120}
                    r={3} fill="#3B82F6" stroke="#fff" strokeWidth={1} />
                )}

                <text x={145} y={108} textAnchor="middle" style={{fontSize:6,fill:"#475569"}}>修复步 →</text>
                {recoveryStep > 0 && (
                  <text x={28+recoveryStep*(232/43)} y={110-recoveryState.curve[recoveryStep]*120-6}
                    textAnchor="middle" style={{fontSize:7,fill:"#93C5FD",fontFamily:"JetBrains Mono"}}>
                    {recoveryState.curve[recoveryStep]?.toFixed(4)}
                  </text>
                )}

                {/* Legend */}
                <line x1={180} y1={5} x2={195} y2={5} stroke="#3B82F6" strokeWidth={1.5} />
                <text x={198} y={7} style={{fontSize:5,fill:"#94A3B8"}}>DRL</text>
                {data.greedyCurve.length > 0 && <>
                  <line x1={215} y1={5} x2={230} y2={5} stroke="#64748B" strokeWidth={1} strokeDasharray="3,2" />
                  <text x={233} y={7} style={{fontSize:5,fill:"#64748B"}}>贪心</text>
                </>}
              </svg>
            </div>
          )}

          {/* Stats Cards (Ch4) */}
          {chapter===4 && (
            <div style={{position:"absolute",bottom:16,right:16,display:"flex",flexDirection:"column",gap:6}}>
              {SUBSYSTEM_NAMES.map((name,i) => {
                const key = SUBSYSTEM_KEYS[i];
                const vals = UNITS.map(u => u[key]);
                const avg = vals.reduce((s,v)=>s+v,0)/vals.length;
                const weakCount = UNITS.filter(u => u.weakest === i).length;
                return (
                  <div key={i} style={{
                    display:"flex",alignItems:"center",gap:8,
                    background:"rgba(15,23,42,0.85)",padding:"5px 10px",
                    borderRadius:6,border:"1px solid rgba(100,116,139,0.15)",
                    borderLeft:`3px solid ${SUBSYSTEM_COLORS[i]}`,
                  }}>
                    <span style={{fontSize:10,color:"#94A3B8",width:80}}>{name}</span>
                    <span style={{fontSize:12,fontFamily:"JetBrains Mono",color:"#e2e8f0",fontWeight:600}}>
                      {avg.toFixed(3)}
                    </span>
                    <span style={{fontSize:9,color:"#64748B"}}>最弱:{weakCount}个</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Quadrant Summary (Ch5) */}
          {chapter===5 && ch5Layer==="quadrant" && (
            <div style={{
              position:"absolute",bottom:16,right:16,
              background:"rgba(15,23,42,0.9)",padding:12,
              borderRadius:8,border:"1px solid rgba(100,116,139,0.2)",
            }}>
              <div style={{fontSize:10,color:"#64748B",marginBottom:6,fontWeight:600}}>风险-韧性四象限分布</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4}}>
                {Object.entries(QUADRANT_LABELS).map(([k,v]) => {
                  const count = UNITS.filter(u => u.quadrant === k).length;
                  return (
                    <div key={k} style={{
                      display:"flex",alignItems:"center",gap:6,padding:"4px 8px",borderRadius:4,
                      background:`${QUADRANT_COLORS[k]}15`,
                    }}>
                      <div style={{width:8,height:8,borderRadius:2,background:QUADRANT_COLORS[k]}} />
                      <span style={{fontSize:10,color:"#CBD5E1"}}>{v}</span>
                      <span style={{fontSize:11,fontFamily:"JetBrains Mono",color:QUADRANT_COLORS[k],fontWeight:600,marginLeft:"auto"}}>
                        {count}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ─── Right: Detail Panel ─── */}
        <div style={{
          width:240,padding:"14px 12px",background:"rgba(15,23,42,0.6)",
          borderLeft:"1px solid rgba(100,116,139,0.15)",overflowY:"auto",
        }}>
          {displayUnit ? (
            <>
              <div style={{fontSize:10,color:"#64748B",fontWeight:600,letterSpacing:1,marginBottom:8}}>
                汇水单元详情
              </div>
              <div style={{
                padding:"8px 10px",borderRadius:6,marginBottom:10,
                background:"rgba(30,41,59,0.8)",border:"1px solid rgba(100,116,139,0.15)",
              }}>
                <div style={{fontSize:14,fontWeight:600,color:"#e2e8f0"}}>
                  {displayUnit.cityName} · WS-{String(displayUnit.wsId).padStart(3,"0")}
                </div>
                <div style={{fontSize:10,color:"#64748B",marginTop:2}}>
                  {displayUnit.x.toFixed(2)}°E, {displayUnit.y.toFixed(2)}°N
                </div>
              </div>

              <DetailSection title="第四章 · 韧性基线" color="#3B82F6">
                <BarIndicator label="综合NFR" value={displayUnit.nfr} color="#3B82F6" />
                <BarIndicator label="网络NRI" value={displayUnit.nri} color="#6366F1" />
                {SUBSYSTEM_NAMES.map((name,i) => (
                  <BarIndicator key={i} label={name} value={displayUnit[SUBSYSTEM_KEYS[i]]}
                    color={SUBSYSTEM_COLORS[i]} isWeakest={displayUnit.weakest===i} />
                ))}
              </DetailSection>

              <DetailSection title="第五章 · 洪涝风险" color="#EF4444">
                <BarIndicator label="综合风险" value={displayUnit.riskScore} color="#EF4444" />
                <BarIndicator label="H 危险性" value={displayUnit.hazard} color="#DC2626" />
                <BarIndicator label="E 暴露性" value={displayUnit.exposure} color="#F97316" />
                <BarIndicator label="S 敏感性" value={displayUnit.sensitivity} color="#EAB308" />
                <BarIndicator label="A 适应性" value={displayUnit.adaptability} color="#22C55E" />
                <div style={{
                  display:"flex",alignItems:"center",gap:6,marginTop:4,
                  padding:"4px 8px",borderRadius:4,background:`${QUADRANT_COLORS[displayUnit.quadrant]}20`,
                }}>
                  <div style={{width:8,height:8,borderRadius:2,background:QUADRANT_COLORS[displayUnit.quadrant]}} />
                  <span style={{fontSize:10,color:"#CBD5E1"}}>
                    {displayUnit.quadrant} {QUADRANT_LABELS[displayUnit.quadrant]}
                  </span>
                  <span style={{fontSize:9,color:"#64748B",marginLeft:"auto"}}>
                    CCD={displayUnit.couplingDegree?.toFixed(3)}
                  </span>
                </div>
              </DetailSection>

              <DetailSection title="第六章 · 恢复优化" color="#10B981">
                <div style={{display:"flex",justifyContent:"space-between",fontSize:10,marginBottom:4}}>
                  <span style={{color:"#94A3B8"}}>修复序号</span>
                  <span style={{fontFamily:"JetBrains Mono",color:"#e2e8f0",fontWeight:600}}>
                    #{displayUnit.repairOrder + 1}/129
                  </span>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:10,marginBottom:4}}>
                  <span style={{color:"#94A3B8"}}>修复阶段</span>
                  <span style={{
                    padding:"1px 6px",borderRadius:3,fontSize:9,
                    background:`${PHASE_COLORS[displayUnit.repairPhase]}25`,
                    color:PHASE_COLORS[displayUnit.repairPhase],fontWeight:600,
                  }}>{displayUnit.repairPhase}</span>
                </div>
                <BarIndicator label="AELD(亿元)" value={displayUnit.aeld/(data.aeldMax||103)} color="#F59E0B"
                  displayValue={displayUnit.aeld.toFixed(2)} />
                <BarIndicator label="枢纽权重" value={displayUnit.hubWeight} color="#8B5CF6" />
                <BarIndicator label="初始损伤" value={displayUnit.damage} color="#EF4444" />
                <BarIndicator label="淹没深度(m)" value={displayUnit.inundDepth/1.5} color="#0EA5E9"
                  displayValue={displayUnit.inundDepth?.toFixed(3)} />
                <div style={{display:"flex",justifyContent:"space-between",fontSize:10,marginTop:4}}>
                  <span style={{color:"#94A3B8"}}>修复状态</span>
                  <span style={{
                    fontFamily:"JetBrains Mono",fontWeight:600,
                    color:recoveryState.currentRepaired.has(displayUnit.id)?"#10B981":"#EF4444",
                  }}>
                    {recoveryState.currentRepaired.has(displayUnit.id)?"已修复":"未修复"}
                  </span>
                </div>
              </DetailSection>

              {/* Radar */}
              <div style={{marginTop:10}}>
                <div style={{fontSize:10,color:"#64748B",fontWeight:600,marginBottom:6}}>四维韧性雷达</div>
                <svg viewBox="0 0 120 120" style={{width:"100%"}}>
                  {[0.25,0.5,0.75,1].map(r => (
                    <polygon key={r} fill="none" stroke="rgba(100,116,139,0.15)" strokeWidth={0.5}
                      points={[0,1,2,3].map(i => {
                        const a = (i/4)*Math.PI*2-Math.PI/2;
                        return `${60+Math.cos(a)*r*45},${60+Math.sin(a)*r*45}`;
                      }).join(" ")} />
                  ))}
                  {SUBSYSTEM_NAMES.map((name,i) => {
                    const a=(i/4)*Math.PI*2-Math.PI/2;
                    return <text key={i} x={60+Math.cos(a)*54} y={60+Math.sin(a)*54}
                      textAnchor="middle" dominantBaseline="middle"
                      style={{fontSize:5,fill:SUBSYSTEM_COLORS[i]}}>{name.replace("韧性","")}</text>;
                  })}
                  <polygon fill="rgba(59,130,246,0.15)" stroke="#3B82F6" strokeWidth={1}
                    points={SUBSYSTEM_KEYS.map((key,i) => {
                      const a=(i/4)*Math.PI*2-Math.PI/2;
                      const v=displayUnit[key];
                      return `${60+Math.cos(a)*v*45},${60+Math.sin(a)*v*45}`;
                    }).join(" ")} />
                  {SUBSYSTEM_KEYS.map((key,i) => {
                    const a=(i/4)*Math.PI*2-Math.PI/2;
                    const v=displayUnit[key];
                    return <circle key={i} cx={60+Math.cos(a)*v*45} cy={60+Math.sin(a)*v*45}
                      r={2.5} fill={SUBSYSTEM_COLORS[i]} stroke="#fff" strokeWidth={0.5} />;
                  })}
                </svg>
              </div>
            </>
          ) : (
            <div style={{
              height:"100%",display:"flex",alignItems:"center",justifyContent:"center",
              flexDirection:"column",gap:8,color:"#475569",fontSize:11,
            }}>
              <div style={{fontSize:24,opacity:0.3}}>◎</div>
              <div>点击汇水单元查看详情</div>
              <div style={{fontSize:10,color:"#334155",textAlign:"center",lineHeight:1.5}}>
                悬停预览 · 点击锁定
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub Components ───
function LayerGroup({label,options,value,onChange}) {
  return (
    <div>
      <div style={{fontSize:10,color:"#94A3B8",fontWeight:500,marginBottom:4}}>{label}</div>
      <div style={{display:"flex",flexDirection:"column",gap:2}}>
        {options.map(opt => (
          <button key={opt.key} onClick={()=>onChange(opt.key)}
            style={{
              padding:"4px 8px",border:"none",cursor:"pointer",borderRadius:3,fontSize:10,textAlign:"left",
              fontFamily:"inherit",
              background:value===opt.key?"rgba(59,130,246,0.2)":"transparent",
              color:value===opt.key?"#93C5FD":"#64748B",transition:"all 0.15s",
            }}>{opt.label}</button>
        ))}
      </div>
    </div>
  );
}

function ColorBar({scheme,label}) {
  const gradient = scheme==="resilience"
    ? "linear-gradient(to right, rgb(220,50,50), rgb(120,110,75), rgb(30,170,100))"
    : "linear-gradient(to right, rgb(40,120,180), rgb(130,90,110), rgb(220,60,40))";
  return (
    <div style={{marginTop:6}}>
      <div style={{height:6,borderRadius:3,background:gradient}} />
      <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#475569",marginTop:2}}>
        <span>{label[0]}</span><span>{label[1]}</span>
      </div>
    </div>
  );
}

function Legend({items}) {
  return (
    <div style={{fontSize:10,display:"flex",flexDirection:"column",gap:3,marginTop:4}}>
      {items.map((item,i) => (
        <div key={i} style={{display:"flex",alignItems:"center",gap:6}}>
          <div style={{
            width:10,height:10,borderRadius:item.glow?"50%":2,background:item.color,
            boxShadow:item.glow?`0 0 6px ${item.color}`:"none",
          }} />
          <span style={{color:"#94A3B8"}}>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function DetailSection({title,color,children}) {
  return (
    <div style={{marginBottom:10}}>
      <div style={{fontSize:10,fontWeight:600,color,marginBottom:6,paddingBottom:4,borderBottom:`1px solid ${color}30`}}>{title}</div>
      {children}
    </div>
  );
}

function BarIndicator({label,value,color,isWeakest,displayValue}) {
  return (
    <div style={{marginBottom:3}}>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:10,marginBottom:1}}>
        <span style={{color:isWeakest?"#EF4444":"#94A3B8"}}>{label}{isWeakest?" ⚠":""}</span>
        <span style={{fontFamily:"JetBrains Mono",fontSize:10,color:"#e2e8f0"}}>
          {displayValue || (value?.toFixed(4) ?? "N/A")}
        </span>
      </div>
      <div style={{height:3,borderRadius:2,background:"rgba(51,65,85,0.5)"}}>
        <div style={{height:"100%",borderRadius:2,background:color,
          width:`${Math.min(value||0,1)*100}%`,transition:"width 0.3s"}} />
      </div>
    </div>
  );
}

const btnStyle = {
  padding:"4px 10px",border:"1px solid rgba(100,116,139,0.3)",
  borderRadius:4,background:"rgba(30,41,59,0.8)",color:"#e2e8f0",
  cursor:"pointer",fontSize:12,fontFamily:"inherit",
};
