# -*- coding: utf-8 -*-
"""生成 watershed_data.json —— 129个汇水单元 + 恢复曲线 + 城市NRI"""
import json, sys, os, warnings
import numpy as np
import pandas as pd
import geopandas as gpd
import jenkspy
warnings.filterwarnings('ignore')
sys.stdout.reconfigure(encoding='utf-8')

BASE = r"E:\大论文数据处理\26年重新计算"
CH6  = rf"{BASE}\第六章v3"
OUT_DIR = r"E:\大论文数据处理\26年重新计算\Github_Platform\bth-resilience-dashboard\public"

# ─── 1) 空间：汇水单元质心坐标 ───
print("[1/11] 计算汇水单元质心...")
gdf = gpd.read_file(rf"{BASE}\流域划分\output\流域单元划分\BTH_watersheds_final.gpkg")
gdf = gdf.sort_values("watershed_id").reset_index(drop=True)
# UTM投影下算质心;同时保留 WGS84 经纬度和 UTM 米制坐标
c_utm = gdf.to_crs(32650).geometry.centroid
c_wgs = gpd.GeoSeries(c_utm, crs=32650).to_crs(4326)
gdf["x"] = c_wgs.x.values        # WGS84 经度 (度)
gdf["y"] = c_wgs.y.values        # WGS84 纬度 (度)
gdf["xUtm"] = c_utm.x.values     # EPSG:32650 东坐标 (米)
gdf["yUtm"] = c_utm.y.values     # EPSG:32650 北坐标 (米)
print(f"   {len(gdf)} 个汇水单元, 经度 [{gdf['x'].min():.2f}, {gdf['x'].max():.2f}]")
print(f"   UTM 东坐标 [{gdf['xUtm'].min():.0f}, {gdf['xUtm'].max():.0f}] m")
print(f"   UTM 北坐标 [{gdf['yUtm'].min():.0f}, {gdf['yUtm'].max():.0f}] m")
print(f"   watershed_id 范围: {gdf['watershed_id'].min()} - {gdf['watershed_id'].max()}")

# ─── 2) 第四/五章综合基座表 ───
print("[2/11] 读取韧性+风险基座表...")
res = pd.read_csv(rf"{CH6}\ch6_watershed_resilience_v5.csv")
print(f"   {len(res)} 行, 列数 {len(res.columns)}")

# ─── 3) 第六章灾损、AEL、DRL ───
print("[3/11] 读取第六章数据...")
dmg = pd.read_csv(rf"{CH6}\ch6_damage_vectors_v5.csv")
ael = pd.read_csv(rf"{CH6}\ch6_AEL_results_v5.csv")
seq = pd.read_csv(rf"{CH6}\drl_results_v7\recovery_sequences.csv")
road = pd.read_csv(rf"{CH6}\networks\road_watershed_summary.csv")
print(f"   灾损: {len(dmg)}行, AEL: {len(ael)}行, DRL序列: {len(seq)}行, 路网: {len(road)}行")

# seq 已完整 129 行 + damage 列；无需补全
seq_full = seq.copy()

# ─── 4) 城市索引映射 ───
CITY_ORDER = ["北京","天津","石家庄","唐山","秦皇岛","邯郸","邢台",
              "保定","张家口","承德","沧州","廊坊","衡水"]
city_idx_map = {c: i for i, c in enumerate(CITY_ORDER)}
city_idx_map_full = dict(city_idx_map)
for c, i in city_idx_map.items():
    city_idx_map_full[c + "市"] = i

# ─── 5) 主表合并 ───
print("[4/11] 合并主表...")
df = gdf[["watershed_id", "main_city", "x", "y", "xUtm", "yUtm"]].copy()

res_cols_want = ["watershed_id","ECON_T_ws_norm","SOC_T_ws_norm","INFRA_T_ws_norm","ECO_T_ws_norm",
                 "NFR_norm","NRI_norm","H_score","E_score","S_score","A_score",
                 "risk_B","quadrant","coupling_coord_D","dominant_shortboard"]
res_cols = [c for c in res_cols_want if c in res.columns]
missing = [c for c in res_cols_want if c not in res.columns]
if missing:
    print(f"   ⚠ 基座表缺列: {missing}")
df = df.merge(res[res_cols], on="watershed_id", how="left")

if "AEL_亿元" in ael.columns:
    df = df.merge(ael[["watershed_id","AEL_亿元"]], on="watershed_id", how="left")
elif "AEL_万元" in ael.columns:
    ael["AEL_亿元"] = ael["AEL_万元"] / 10000.0
    df = df.merge(ael[["watershed_id","AEL_亿元"]], on="watershed_id", how="left")

dmg_cols = [c for c in ["watershed_id","composite_RP100_m","damage_ratio_RP100"] if c in dmg.columns]
df = df.merge(dmg[dmg_cols], on="watershed_id", how="left")

df = df.merge(
    seq_full[["ws_id","rank","hub","damage"]].rename(
        columns={"ws_id":"watershed_id","rank":"drl_rank",
                 "hub":"hub_weight","damage":"drl_damage"}),
    on="watershed_id", how="left")

if "pct_blocked" in road.columns:
    road2 = road[["watershed_id","pct_blocked"]].copy()
    road2["watershed_id"] = road2["watershed_id"].astype(int)
    df = df.merge(road2, on="watershed_id", how="left")

# ─── 6) 派生字段 ───
print("[5/11] 计算派生字段...")
df["cityIdx"] = df["main_city"].map(city_idx_map_full)
df["repairOrder"] = (df["drl_rank"] - 1).astype("Int64")  # 0-based

df["repairPhase"] = np.where(df["repairOrder"] < 45, "紧急",
                     np.where(df["repairOrder"] < 84, "系统", "收尾"))

SHORTBOARD_MAP = {"ECON":0, "SOC":1, "INFRA":2, "ECO":3}
if "dominant_shortboard" in df.columns:
    df["weakestSubsystem"] = df["dominant_shortboard"].map(SHORTBOARD_MAP)

# ─── 7) 构建JSON ───
print("[6/11] 生成 JSON 记录...")

def safe_float(val, default=0.0):
    try:
        v = float(val)
        return round(v, 4) if not np.isnan(v) else default
    except Exception:
        return default

def safe_int(val, default=-1):
    try:
        if val is None or (isinstance(val, float) and np.isnan(val)):
            return default
        return int(val)
    except Exception:
        return default

units = []
for _, r in df.iterrows():
    dmg_ratio = r.get("damage_ratio_RP100")
    if pd.isna(dmg_ratio):
        dmg_ratio = r.get("drl_damage")
    unit = {
        "id": int(r["watershed_id"]) - 1,       # 0-128
        "wsId": int(r["watershed_id"]),          # 1-129
        "cityName": str(r["main_city"]).replace("市",""),
        "cityIdx": safe_int(r.get("cityIdx")),
        "x": safe_float(r["x"]),
        "y": safe_float(r["y"]),
        "xUtm": round(float(r["xUtm"]), 1),
        "yUtm": round(float(r["yUtm"]), 1),
        "econR":  safe_float(r.get("ECON_T_ws_norm")),
        "socR":   safe_float(r.get("SOC_T_ws_norm")),
        "infraR": safe_float(r.get("INFRA_T_ws_norm")),
        "ecoR":   safe_float(r.get("ECO_T_ws_norm")),
        "nfr":    safe_float(r.get("NFR_norm")),
        "nri":    safe_float(r.get("NRI_norm")),
        "hazard":       safe_float(r.get("H_score")),
        "exposure":     safe_float(r.get("E_score")),
        "sensitivity":  safe_float(r.get("S_score")),
        "adaptability": safe_float(r.get("A_score")),
        "riskScore":     safe_float(r.get("risk_B")),
        "quadrant":      str(r.get("quadrant","LL")) if pd.notna(r.get("quadrant")) else "LL",
        "couplingDegree":safe_float(r.get("coupling_coord_D")),
        "aeld":      safe_float(r.get("AEL_亿元")),
        "damage":    safe_float(dmg_ratio),
        "hubWeight": safe_float(r.get("hub_weight")),
        "repairOrder": safe_int(r.get("repairOrder")),
        "repairPhase": str(r.get("repairPhase","收尾")),
        "inundDepth":     safe_float(r.get("composite_RP100_m")),
        "roadDamageRate": safe_float(r.get("pct_blocked",0))/100.0,
        "weakestSubsystem": safe_int(r.get("weakestSubsystem")),
    }
    units.append(unit)

# ─── 8) 恢复曲线 ───
print("[7/11] 提取恢复曲线...")
curves = pd.read_csv(rf"{CH6}\drl_results_v7\recovery_curves.csv")
print(f"   曲线总行: {len(curves)}, 策略: {list(curves['strategy'].unique())}")
print(f"   情景: {list(curves['scenario'].unique())}")

drl_curve_df = curves[(curves["strategy"]=="DRL_dueling_ddqn") &
                      (curves["scenario"]=="SSP585")].sort_values("step")
recovery_curve = [round(float(v),4) for v in drl_curve_df["F"].values]
print(f"   DRL SSP585 曲线长度={len(recovery_curve)}, F(0)={recovery_curve[0]}, F(末)={recovery_curve[-1]}")

greedy_df = curves[(curves["strategy"]=="greedy") &
                   (curves["scenario"]=="SSP585")].sort_values("step")
greedy_curve = [round(float(v),4) for v in greedy_df["F"].values] if len(greedy_df) else []
print(f"   greedy 曲线长度={len(greedy_curve)}")

# ─── 9) 城市级NRI ───
print("[8/11] 读取城市NRI...")
cities_data = []
try:
    nri_df = pd.read_csv(r"E:\大论文数据处理\python_codes\网络韧性\fig_v7_improved\tables\city_NRI_G1_G2.csv")
    nri_g1 = nri_df[nri_df["graph"]=="G1_full"] if "graph" in nri_df.columns else nri_df
    for _, row in nri_g1.iterrows():
        city_name = str(row.get("city","")).replace("市","")
        cities_data.append({
            "name": city_name,
            "idx":  city_idx_map.get(city_name, -1),
            "nri":  safe_float(row.get("NRI")),
            "nriNorm": safe_float(row.get("NRI_norm")),
        })
    print(f"   {len(cities_data)} 个城市")
except Exception as e:
    print(f"   ⚠ NRI 读取失败: {e}")

# ─── 9b) Jenks 5 分级断点(每个连续字段) ───
print("[9a] 计算 Jenks 5 分级...")
JENKS_FIELDS = [
    "econR","socR","infraR","ecoR","nfr","nri",
    "hazard","exposure","sensitivity","adaptability","riskScore","couplingDegree",
    "aeld","damage","hubWeight","inundDepth","roadDamageRate",
]
jenks_breaks = {}
for fld in JENKS_FIELDS:
    vals = np.array([u[fld] for u in units], dtype=float)
    vals = vals[~np.isnan(vals)]
    vals = vals[vals > 0] if fld in ("roadDamageRate",) else vals  # 0 多时剔除再分
    if len(vals) < 6:
        continue
    try:
        brks = jenkspy.jenks_breaks(vals, n_classes=5)
    except Exception as e:
        print(f"   ⚠ {fld} Jenks 失败: {e}")
        continue
    jenks_breaks[fld] = [round(float(b), 4) for b in brks]
    cts = [int(((vals >= brks[i]) & (vals <= brks[i+1])).sum()) if i == 4
           else int(((vals >= brks[i]) & (vals < brks[i+1])).sum())
           for i in range(5)]
    print(f"   {fld:16s} → {jenks_breaks[fld]}  类计数 {cts}")

# ─── 10) 输出JSON ───
print("[9/11] 写入 JSON...")
payload = {
    "watersheds": units,
    "recoveryCurve": recovery_curve,
    "greedyCurve": greedy_curve,
    "cities": cities_data,
    "meta": {
        "totalUnits": len(units),
        "totalCities": 13,
        "totalGrids": 218766,
        "crs": "EPSG:4326",
        "recoveryScenario": "SSP585",
        "bestVariant": "dueling_ddqn",
        "curveSteps": len(recovery_curve),
        "jenksBreaks": jenks_breaks,
        "description": "京津冀城市群洪涝韧性全过程评估数据"
    }
}

os.makedirs(OUT_DIR, exist_ok=True)
out_path = os.path.join(OUT_DIR, "watershed_data.json")
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False)

file_size_kb = os.path.getsize(out_path)/1024
print(f"\n[10/11] ✅ 已生成: {out_path}")
print(f"   文件大小: {file_size_kb:.1f} KB")
print(f"   汇水单元: {len(units)} 个")
print(f"   恢复曲线: {len(recovery_curve)} 步 (F(0)={recovery_curve[0]}, F(末)={recovery_curve[-1]})")
print(f"   城市:    {len(cities_data)} 个")

# ─── 11) 数据质量检查 ───
print("\n[11/11] 数据质量检查:")
for field in ["econR","socR","infraR","ecoR","nfr","nri",
              "hazard","exposure","sensitivity","adaptability","riskScore",
              "aeld","damage","hubWeight","inundDepth","roadDamageRate"]:
    vals = [u[field] for u in units if u[field] != 0.0]
    if vals:
        print(f"   {field:18s}: min={min(vals):.4f}  max={max(vals):.4f}  mean={sum(vals)/len(vals):.4f}  非零={len(vals)}")
    else:
        print(f"   {field:18s}: ⚠ 全零或缺失")

from collections import Counter
quad_counts = Counter(u["quadrant"] for u in units)
phase_counts = Counter(u["repairPhase"] for u in units)
city_counts = Counter(u["cityName"] for u in units)
weak_counts = Counter(u["weakestSubsystem"] for u in units)
city_idx_bad = sum(1 for u in units if u["cityIdx"] < 0)

print(f"   四象限分布: {dict(quad_counts)}")
print(f"   修复阶段分布: {dict(phase_counts)}")
print(f"   最弱子系统分布(0econ/1soc/2infra/3eco): {dict(weak_counts)}")
print(f"   城市分布: {dict(city_counts)}")
print(f"   cityIdx 未映射数: {city_idx_bad}")
