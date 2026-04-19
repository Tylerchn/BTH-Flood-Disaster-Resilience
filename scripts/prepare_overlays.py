# -*- coding: utf-8 -*-
"""生成河流/避难场所/医院 GeoJSON,供前端叠加"""
import geopandas as gpd, os, sys, warnings
warnings.filterwarnings('ignore')
sys.stdout.reconfigure(encoding='utf-8')

OUT_DIR = r"E:\大论文数据处理\26年重新计算\Github_Platform\bth-resilience-dashboard\public"

def to_wgs(gdf):
    return gdf.to_crs(4326) if (gdf.crs and gdf.crs.to_epsg()!=4326) else gdf

def save_simplified_polygons(src, out_name, tol=0.0015, min_area_deg2=0.0, drop_cols=None):
    print(f"\n[{out_name}] 读 {src}")
    gdf = gpd.read_file(src)
    gdf = to_wgs(gdf)
    print(f"  原始 {len(gdf)} 要素")

    # BTH 经纬度范围裁剪(气溶 10%)
    gdf = gdf.cx[113.0:120.5, 35.5:43.0]
    print(f"  BTH 范围内 {len(gdf)} 要素")

    # 大多边形优先:按面积过滤小的零碎
    if min_area_deg2 > 0:
        areas = gdf.geometry.area
        gdf = gdf[areas >= min_area_deg2].copy()
        print(f"  面积过滤后 {len(gdf)} 要素")

    before = gdf.geometry.apply(lambda g: len(g.wkt)).sum()
    gdf["geometry"] = gdf.geometry.simplify(tol, preserve_topology=True)
    invalid = (~gdf.geometry.is_valid).sum()
    if invalid > 0:
        gdf["geometry"] = gdf.geometry.buffer(0)
    after = gdf.geometry.apply(lambda g: len(g.wkt)).sum()
    print(f"  WKT {before:,} → {after:,} (×{before/after:.1f})")

    if drop_cols:
        for c in drop_cols:
            if c in gdf.columns: gdf = gdf.drop(columns=[c])

    out = os.path.join(OUT_DIR, out_name)
    if os.path.exists(out): os.remove(out)
    gdf.to_file(out, driver="GeoJSON")
    print(f"  ✅ {out}  {os.path.getsize(out)/1024:.1f} KB")

def save_points(src, out_name, keep_cols):
    print(f"\n[{out_name}] 读 {src}")
    gdf = gpd.read_file(src)
    gdf = to_wgs(gdf)
    print(f"  {len(gdf)} 个点")
    # 只保留需要的列
    keep = [c for c in keep_cols if c in gdf.columns] + ["geometry"]
    gdf = gdf[keep]
    out = os.path.join(OUT_DIR, out_name)
    if os.path.exists(out): os.remove(out)
    gdf.to_file(out, driver="GeoJSON")
    print(f"  ✅ {out}  {os.path.getsize(out)/1024:.1f} KB")

# 1) 河流水系
save_simplified_polygons(
    src=r"E:\大论文数据处理\data\京津冀_水系.shp",
    out_name="rivers.geojson",
    tol=0.004,              # ~400m 简化精度,网页展示足够
    min_area_deg2=1e-5,     # 约 >10 公顷,丢掉小水塘只留河道/水库/湖泊
    drop_cols=["gml_id","Name","fclass"],
)

# 2) 应急避难场所
save_points(
    src=r"E:\大论文数据处理\data\京津冀应急避难场所点位.shp",
    out_name="shelters.geojson",
    keep_cols=["name","address","adname"],
)

# 3) 三级医院
save_points(
    src=r"E:\大论文数据处理\data\京津冀三级医院分布.shp",
    out_name="hospitals.geojson",
    keep_cols=["name","address"],
)

print("\n== 完成 ==")
for f in ["rivers.geojson","shelters.geojson","hospitals.geojson"]:
    p = os.path.join(OUT_DIR, f)
    if os.path.exists(p):
        print(f"  {f}: {os.path.getsize(p)/1024:.1f} KB")
