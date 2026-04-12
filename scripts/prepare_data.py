"""
数据准备脚本：将你的论文CSV数据转换为网站可用的JSON格式
====================================================

使用方法：
1. 修改下面的文件路径，指向你的实际数据文件
2. 运行: python prepare_data.py
3. 生成的 watershed_data.json 复制到项目的 public/ 文件夹

依赖: pip install pandas geopandas

你需要准备的数据文件（根据你的实际文件名修改路径）：
- watershed_indicators_raw.csv    → 第四章韧性基线指标
- watershed_flood_risk_final.csv  → 第五章综合风险
- coupling_quadrant_result.csv    → 第五章四象限耦合
- DRL修复序列结果                  → 第六章恢复优化
- BTH_watersheds_final.gpkg       → 汇水单元矢量边界（可选，用于真实地图）
"""

import pandas as pd
import json
import os

# ============================================================
# ⚠️ 修改这里的路径，指向你的实际数据文件
# ============================================================
DATA_ROOT = r"E:\大论文数据处理\26年重新计算"

# 第四章：韧性基线
RESILIENCE_CSV = os.path.join(DATA_ROOT, "韧性基线", "watershed_indicators_raw.csv")

# 第五章：洪涝风险
RISK_CSV = os.path.join(DATA_ROOT, "洪涝风险", "watershed_flood_risk_final.csv")
QUADRANT_CSV = os.path.join(DATA_ROOT, "洪涝风险", "coupling_quadrant_result.csv")
COUPLING_CSV = os.path.join(DATA_ROOT, "洪涝风险", "coupling_full_result.csv")

# 第六章：DRL恢复
DRL_DIR = os.path.join(DATA_ROOT, "drl_results_v7")

# 城市归属查找表
CITY_LOOKUP = os.path.join(DATA_ROOT, "watershed_city_lookup.csv")

# 汇水单元矢量（可选，用于生成GeoJSON）
WATERSHED_GPKG = os.path.join(DATA_ROOT, "BTH_watersheds_final.gpkg")

# 输出路径
OUTPUT_JSON = "public/watershed_data.json"
OUTPUT_GEOJSON = "public/watersheds.geojson"  # 可选


def load_resilience_data():
    """加载第四章韧性基线数据"""
    print("📊 加载韧性基线数据...")
    
    # 根据你的实际列名修改
    # 预期列: ws_id, ECON_T, SOC_T, INFRA_T, ECO_T, RES_B 等
    try:
        df = pd.read_csv(RESILIENCE_CSV)
        print(f"   读取 {len(df)} 行, 列: {list(df.columns)}")
        return df
    except FileNotFoundError:
        print(f"   ⚠️ 文件不存在: {RESILIENCE_CSV}")
        print("   将使用模拟数据")
        return None


def load_risk_data():
    """加载第五章风险评估数据"""
    print("📊 加载风险评估数据...")
    
    try:
        risk_df = pd.read_csv(RISK_CSV)
        print(f"   风险数据: {len(risk_df)} 行")
    except FileNotFoundError:
        print(f"   ⚠️ 文件不存在: {RISK_CSV}")
        risk_df = None
    
    try:
        quad_df = pd.read_csv(QUADRANT_CSV)
        print(f"   四象限数据: {len(quad_df)} 行")
    except FileNotFoundError:
        print(f"   ⚠️ 文件不存在: {QUADRANT_CSV}")
        quad_df = None
    
    return risk_df, quad_df


def load_drl_data():
    """加载第六章DRL恢复数据"""
    print("📊 加载DRL恢复数据...")
    
    try:
        # 查找DRL结果文件
        # 根据你的实际文件结构修改
        repair_sequence_file = os.path.join(DRL_DIR, "repair_sequence.csv")
        if os.path.exists(repair_sequence_file):
            df = pd.read_csv(repair_sequence_file)
            print(f"   修复序列: {len(df)} 行")
            return df
        
        # 如果没有现成的CSV，尝试从其他格式读取
        import glob
        files = glob.glob(os.path.join(DRL_DIR, "*.csv"))
        print(f"   DRL目录中找到文件: {files}")
        return None
    except Exception as e:
        print(f"   ⚠️ 加载DRL数据失败: {e}")
        return None


def load_city_lookup():
    """加载城市归属查找表"""
    try:
        df = pd.read_csv(CITY_LOOKUP)
        return df
    except FileNotFoundError:
        print(f"   ⚠️ 城市查找表不存在: {CITY_LOOKUP}")
        return None


def export_geojson():
    """（可选）将汇水单元矢量导出为GeoJSON供网页地图使用"""
    print("🗺️ 导出GeoJSON...")
    
    try:
        import geopandas as gpd
        gdf = gpd.read_file(WATERSHED_GPKG)
        
        # 转换到WGS84经纬度坐标（网页地图需要）
        gdf_wgs84 = gdf.to_crs(epsg=4326)
        
        # 简化几何体以减小文件大小（tolerance越大文件越小但越粗糙）
        gdf_wgs84["geometry"] = gdf_wgs84["geometry"].simplify(tolerance=0.005)
        
        # 只保留必要的列
        cols_to_keep = ["ws_id", "geometry"]  # 根据实际列名修改
        gdf_export = gdf_wgs84[[c for c in cols_to_keep if c in gdf_wgs84.columns] + ["geometry"]]
        
        gdf_export.to_file(OUTPUT_GEOJSON, driver="GeoJSON")
        
        file_size = os.path.getsize(OUTPUT_GEOJSON) / 1024 / 1024
        print(f"   ✅ GeoJSON已导出: {OUTPUT_GEOJSON} ({file_size:.1f} MB)")
        
        if file_size > 5:
            print(f"   ⚠️ 文件较大，建议增加simplify的tolerance值")
        
    except ImportError:
        print("   ⚠️ 需要安装 geopandas: pip install geopandas")
    except FileNotFoundError:
        print(f"   ⚠️ 文件不存在: {WATERSHED_GPKG}")
    except Exception as e:
        print(f"   ⚠️ GeoJSON导出失败: {e}")


def build_json():
    """整合所有数据并输出为JSON"""
    print("\n🔧 开始整合数据...\n")
    
    res_df = load_resilience_data()
    risk_df, quad_df = load_risk_data()
    drl_df = load_drl_data()
    city_df = load_city_lookup()
    
    # ── 构建每个汇水单元的数据记录 ──
    units = []
    
    n_units = 129  # 你的汇水单元数量
    
    for i in range(n_units):
        unit = {"id": i}
        
        # 第四章数据
        if res_df is not None and i < len(res_df):
            row = res_df.iloc[i]
            # ⚠️ 根据你的实际列名修改这里
            unit["econR"] = float(row.get("ECON_T", 0))
            unit["socR"] = float(row.get("SOC_T", 0))
            unit["infraR"] = float(row.get("INFRA_T", 0))
            unit["ecoR"] = float(row.get("ECO_T", 0))
            unit["nfr"] = float(row.get("RES_B", 0))
        
        # 第五章数据
        if risk_df is not None and i < len(risk_df):
            row = risk_df.iloc[i]
            # ⚠️ 根据你的实际列名修改
            unit["hazard"] = float(row.get("hazard_score", 0))
            unit["exposure"] = float(row.get("exposure_score", 0))
            unit["sensitivity"] = float(row.get("sensitivity_score", 0))
            unit["adaptability"] = float(row.get("adaptability_score", 0))
            unit["riskScore"] = float(row.get("risk_B", 0))
        
        if quad_df is not None and i < len(quad_df):
            row = quad_df.iloc[i]
            unit["quadrant"] = str(row.get("quadrant", "LL"))
        
        # 第六章数据
        if drl_df is not None and i < len(drl_df):
            row = drl_df.iloc[i]
            unit["repairOrder"] = int(row.get("repair_order", i))
            unit["aeld"] = float(row.get("aeld", 0))
            unit["damage"] = float(row.get("damage", 0))
            unit["hubWeight"] = float(row.get("hub_weight", 0))
        
        # 城市归属
        if city_df is not None and i < len(city_df):
            row = city_df.iloc[i]
            unit["cityName"] = str(row.get("city_name", ""))
            unit["cityIdx"] = int(row.get("city_idx", 0))
        
        units.append(unit)
    
    # ── 构建恢复曲线数据 ──
    recovery_curve = []
    # 如果有DRL训练结果中的恢复曲线数据，在这里加载
    # recovery_curve = pd.read_csv("path/to/recovery_curve.csv")["F"].tolist()
    
    # ── 输出 ──
    output = {
        "units": units,
        "recoveryCurve": recovery_curve,
        "metadata": {
            "totalUnits": n_units,
            "totalCities": 13,
            "totalGrids": 218766,
            "description": "京津冀城市群洪涝韧性全过程评估数据",
        }
    }
    
    os.makedirs(os.path.dirname(OUTPUT_JSON), exist_ok=True)
    
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    
    file_size = os.path.getsize(OUTPUT_JSON) / 1024
    print(f"\n✅ JSON数据已生成: {OUTPUT_JSON} ({file_size:.1f} KB)")
    print(f"   包含 {len(units)} 个汇水单元数据")
    
    # 可选：导出GeoJSON
    # export_geojson()
    
    print("\n📋 下一步:")
    print("   1. 检查生成的 JSON 文件内容是否正确")
    print("   2. 将 public/watershed_data.json 提交到 GitHub 仓库")
    print("   3. 修改 Dashboard.jsx 中的数据加载代码（参见教程）")


if __name__ == "__main__":
    build_json()
