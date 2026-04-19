# -*- coding: utf-8 -*-
"""生成城市间网络联系韧性边 GeoJSON
每条边 LineString[city_u → city_v], properties: u, v, w (W_sym), cls (1-5)
坐标使用 watershed_data.json 里每个城市下辖汇水单元质心的平均值
"""
import json, os, sys, warnings
import pandas as pd
warnings.filterwarnings('ignore')
sys.stdout.reconfigure(encoding='utf-8')

OUT_DIR = r"E:\大论文数据处理\26年重新计算\Github_Platform\bth-resilience-dashboard\public"
WS_JSON = os.path.join(OUT_DIR, "watershed_data.json")
EDGE_CSV = r"E:\大论文数据处理\python_codes\网络韧性\fig_v7_improved\tables\edges_G1_undirected.csv"
EDGE_CSV_BB = r"E:\大论文数据处理\python_codes\网络韧性\fig_v7_improved\tables\edges_G2_backbone.csv"

def build(edge_csv, out_name, tag):
    with open(WS_JSON, encoding="utf-8") as f:
        ws = json.load(f)
    # 按城市名聚合汇水单元质心,得到每城市的代表点(均值)
    city_pt = {}
    for u in ws["watersheds"]:
        c = u["cityName"]
        city_pt.setdefault(c, []).append((u["x"], u["y"]))
    city_pt = {c: (sum(p[0] for p in pts)/len(pts), sum(p[1] for p in pts)/len(pts))
               for c, pts in city_pt.items()}
    print(f"[{tag}] 城市质心数: {len(city_pt)}")

    edges = pd.read_csv(edge_csv)
    print(f"[{tag}] 边数: {len(edges)}, 列: {list(edges.columns)}")

    features = []
    skipped = 0
    for _, r in edges.iterrows():
        u, v = str(r["city_u"]).strip(), str(r["city_v"]).strip()
        if u not in city_pt or v not in city_pt:
            skipped += 1
            continue
        pu, pv = city_pt[u], city_pt[v]
        features.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": [[pu[0], pu[1]], [pv[0], pv[1]]]},
            "properties": {
                "u": u, "v": v,
                "w": round(float(r["W_sym"]), 4),
                "cls": int(r["cls5"]),
            },
        })
    if skipped:
        print(f"  ⚠ 跳过 {skipped} 条(城市名未匹配)")
    gj = {"type": "FeatureCollection", "features": features}
    out = os.path.join(OUT_DIR, out_name)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(gj, f, ensure_ascii=False)
    print(f"  ✅ {out}  {os.path.getsize(out)/1024:.1f} KB  边={len(features)}")

build(EDGE_CSV,   "city_edges_g1.geojson", "G1-全连接")
build(EDGE_CSV_BB,"city_edges_g2.geojson", "G2-骨干")
