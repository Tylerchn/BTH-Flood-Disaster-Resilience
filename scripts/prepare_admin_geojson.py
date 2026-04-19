# -*- coding: utf-8 -*-
"""将城市边界与区县边界 shapefile 转成简化的 WGS84 GeoJSON"""
import geopandas as gpd, pandas as pd, os, sys, json, warnings
warnings.filterwarnings('ignore')
sys.stdout.reconfigure(encoding='utf-8')

OUT_DIR = r"E:\大论文数据处理\26年重新计算\Github_Platform\bth-resilience-dashboard\public"

def convert(src, out_name, keep_cols, rename, simp_tol):
    print(f"\n[{out_name}] 读取 {src}")
    gdf = gpd.read_file(src)
    print(f"  rows={len(gdf)}, CRS={gdf.crs}")

    if gdf.crs and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(4326)
        print("  → 已转至 EPSG:4326")

    # 简化几何
    before = gdf.geometry.apply(lambda g: len(g.wkt)).sum()
    gdf["geometry"] = gdf["geometry"].simplify(simp_tol, preserve_topology=True)
    # buffer(0) 修复 simplify 产生的 nested shells / hole-outside-shell
    invalid_before = (~gdf.geometry.is_valid).sum()
    if invalid_before > 0:
        gdf["geometry"] = gdf.geometry.buffer(0)
        print(f"  修复几何: {invalid_before} → {(~gdf.geometry.is_valid).sum()}")
    after = gdf.geometry.apply(lambda g: len(g.wkt)).sum()
    print(f"  WKT 字符 {before:,} → {after:,} (×{before/after:.1f})")

    # 精简列
    miss = [c for c in keep_cols if c not in gdf.columns]
    if miss:
        print(f"  ⚠ 缺字段: {miss}")
    keep = [c for c in keep_cols if c in gdf.columns] + ["geometry"]
    gdf = gdf[keep].rename(columns=rename)

    out = os.path.join(OUT_DIR, out_name)
    if os.path.exists(out):
        os.remove(out)
    gdf.to_file(out, driver="GeoJSON")
    kb = os.path.getsize(out)/1024
    print(f"  ✅ {out}  {kb:.1f} KB")
    return out

os.makedirs(OUT_DIR, exist_ok=True)

# 城市边界 (13)
convert(
    src=r"E:\大论文数据处理\data\京津冀13城市边界_32650.shp",
    out_name="cities.geojson",
    keep_cols=["地名"],
    rename={"地名": "name"},
    simp_tol=0.005,  # 城市尺度较大,简化程度可更高
)

# 区县边界 (199)
convert(
    src=r"E:\大论文数据处理\data\京津冀_行政区边界.shp",
    out_name="counties.geojson",
    keep_cols=["地名", "地级", "省级"],
    rename={"地名": "name", "地级": "city", "省级": "province"},
    simp_tol=0.003,  # 区县尺度较小,保留更多细节
)

# 区县标签 (Point 质心,用于前端 HTML 叠加)
print("\n[counties_labels.geojson] 计算质心...")
cgdf = gpd.read_file(r"E:\大论文数据处理\data\京津冀_行政区边界.shp")
# UTM 下算质心,再转回 WGS84
centroid_utm = cgdf.to_crs(32650).geometry.centroid
centroid_wgs = gpd.GeoSeries(centroid_utm, crs=32650).to_crs(4326)
pts = gpd.GeoDataFrame({
    "name": cgdf["地名"].values,
    "city": cgdf["地级"].values,
    "geometry": centroid_wgs,
}, crs=4326)
out_pts = os.path.join(OUT_DIR, "counties_labels.geojson")
if os.path.exists(out_pts): os.remove(out_pts)
pts.to_file(out_pts, driver="GeoJSON")
print(f"  ✅ {out_pts}  {os.path.getsize(out_pts)/1024:.1f} KB, {len(pts)} 个点")

# 末端检查
for f in ["cities.geojson", "counties.geojson"]:
    p = os.path.join(OUT_DIR, f)
    g = gpd.read_file(p)
    bounds = g.total_bounds
    print(f"\n[{f}] 校验: {len(g)} 要素, "
          f"经度 [{bounds[0]:.2f}, {bounds[2]:.2f}], 纬度 [{bounds[1]:.2f}, {bounds[3]:.2f}]")
    print(f"  字段: {list(g.columns)}")
    print(f"  前3行 name: {g['name'].head(3).tolist()}")
