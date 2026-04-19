# -*- coding: utf-8 -*-
"""将 BTH_watersheds_final.gpkg 转换为简化的 GeoJSON 供网站使用"""
import geopandas as gpd
import json
import os
import sys
import warnings
warnings.filterwarnings('ignore')
sys.stdout.reconfigure(encoding='utf-8')

INPUT_GPKG = r"E:\大论文数据处理\26年重新计算\流域划分\output\流域单元划分\BTH_watersheds_final.gpkg"
OUTPUT_DIR = r"E:\大论文数据处理\26年重新计算\Github_Platform\bth-resilience-dashboard\public"
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "watersheds.geojson")

# ─── 1) 读取 GPKG ───
print("[1/5] 读取 GPKG...")
gdf = gpd.read_file(INPUT_GPKG)
print(f"   行数: {len(gdf)}")
print(f"   列名: {list(gdf.columns)}")
print(f"   当前CRS: {gdf.crs}")
print(f"   watershed_id 范围: {gdf['watershed_id'].min()} - {gdf['watershed_id'].max()}")

# ─── 2) 转换坐标系到 WGS84 ───
print("[2/5] 转换坐标系到 EPSG:4326 (WGS84)...")
src_crs = gdf.crs
if gdf.crs and gdf.crs.to_epsg() != 4326:
    gdf = gdf.to_crs(epsg=4326)
    print(f"   已从 {src_crs} 转换到 EPSG:4326")
else:
    print("   已经是 EPSG:4326,无需转换")

# ─── 3) 简化几何体 ───
print("[3/5] 简化几何体...")
original_size = gdf.geometry.apply(lambda g: len(g.wkt)).sum()

gdf_simplified = gdf.copy()
gdf_simplified["geometry"] = gdf_simplified["geometry"].simplify(
    tolerance=0.003, preserve_topology=True)

# 简化会在部分 MultiPolygon 上产生 nested shells / hole-outside-shell
# 用 buffer(0) 修复(不用 dissolve/unary_union/union_all)
invalid_before = (~gdf_simplified.geometry.is_valid).sum()
if invalid_before > 0:
    gdf_simplified["geometry"] = gdf_simplified.geometry.buffer(0)
    invalid_after = (~gdf_simplified.geometry.is_valid).sum()
    print(f"   修复几何: 无效 {invalid_before} → {invalid_after}")

simplified_size = gdf_simplified.geometry.apply(lambda g: len(g.wkt)).sum()
print(f"   原始复杂度: {original_size:,} 字符")
print(f"   简化后:    {simplified_size:,} 字符 (压缩比: {original_size/simplified_size:.1f}x)")

# ─── 4) 精简列 ───
print("[4/5] 精简列...")
cols_to_keep = ["watershed_id", "geometry"]
if "main_city" in gdf_simplified.columns:
    cols_to_keep.append("main_city")
if "area_km2" in gdf_simplified.columns:
    cols_to_keep.append("area_km2")

gdf_export = gdf_simplified[cols_to_keep].copy()
gdf_export = gdf_export.rename(columns={"watershed_id": "id"})
print(f"   保留列: {list(gdf_export.columns)}")

# ─── 5) 导出 GeoJSON ───
print("[5/5] 导出 GeoJSON...")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# 若目标文件已存在,先删除,避免 GeoJSON driver 追加/覆盖行为差异
if os.path.exists(OUTPUT_FILE):
    os.remove(OUTPUT_FILE)

gdf_export.to_file(OUTPUT_FILE, driver="GeoJSON")

file_size_mb = os.path.getsize(OUTPUT_FILE) / 1024 / 1024
print(f"\n✅ 导出完成: {OUTPUT_FILE}")
print(f"   文件大小: {file_size_mb:.2f} MB")
print(f"   要素数: {len(gdf_export)}")

if file_size_mb > 5:
    print(f"\n⚠ 文件较大 ({file_size_mb:.1f}MB),建议增大 simplify tolerance")
elif file_size_mb > 2:
    print(f"\n💡 文件 {file_size_mb:.1f}MB,可接受但首次加载会略慢")
else:
    print(f"\n✅ 文件大小理想 ({file_size_mb:.2f}MB),网页加载会很快")

# ─── 验证 ───
print("\n📋 验证检查:")
gdf_check = gpd.read_file(OUTPUT_FILE)
print(f"   读回行数: {len(gdf_check)}")
print(f"   CRS: {gdf_check.crs}")
print(f"   id 范围: {gdf_check['id'].min()} - {gdf_check['id'].max()}")
print(f"   前3行 id: {list(gdf_check['id'].head(3).values)}")

bounds = gdf_check.total_bounds
print(f"   经度范围: {bounds[0]:.2f} - {bounds[2]:.2f}")
print(f"   纬度范围: {bounds[1]:.2f} - {bounds[3]:.2f}")
if 113 < bounds[0] < 120 and 35 < bounds[1] < 43:
    print("   ✅ 经纬度范围合理(京津冀区域)")
else:
    print("   ⚠ 经纬度范围异常,请检查CRS转换")

# 几何类型 & 空/无效几何检查
geom_types = gdf_check.geom_type.value_counts().to_dict()
print(f"   几何类型: {geom_types}")
empty_or_invalid = int(gdf_check.geometry.is_empty.sum() + (~gdf_check.geometry.is_valid).sum())
print(f"   空/无效几何数: {empty_or_invalid}")
