# -*- coding: utf-8 -*-
import pandas as pd
import sys

# Force stdout to UTF-8 so Chinese column names don't get mangled
sys.stdout.reconfigure(encoding='utf-8')

files = {
    "resilience": r"E:\大论文数据处理\26年重新计算\第六章v3\ch6_watershed_resilience_v5.csv",
    "damage": r"E:\大论文数据处理\26年重新计算\第六章v3\ch6_damage_vectors_v5.csv",
    "ael": r"E:\大论文数据处理\26年重新计算\第六章v3\ch6_AEL_results_v5.csv",
    "seq": r"E:\大论文数据处理\26年重新计算\第六章v3\drl_results_v7\recovery_sequences.csv",
    "curves": r"E:\大论文数据处理\26年重新计算\第六章v3\drl_results_v7\recovery_curves.csv",
    "road": r"E:\大论文数据处理\26年重新计算\第六章v3\networks\road_watershed_summary.csv",
    "nri": r"E:\大论文数据处理\python_codes\网络韧性\fig_v7_improved\tables\city_NRI_G1_G2.csv",
}

for name, path in files.items():
    df = pd.read_csv(path)
    print(f"\n=== {name} ({len(df)} rows) ===")
    print(f"cols: {list(df.columns)}")
    if len(df) > 0:
        print(f"head(1): {df.head(1).to_dict(orient='records')}")

# Special inspection
curves = pd.read_csv(files["curves"])
print(f"\n=== curves strategies ===")
print(curves["strategy"].unique())
print(f"scenarios: {curves['scenario'].unique()}")
ssp585_drl = curves[(curves["strategy"]=="DRL_dueling_ddqn") & (curves["scenario"]=="SSP585")].sort_values("step")
print(f"DRL_dueling_ddqn SSP585: {len(ssp585_drl)} steps, F range [{ssp585_drl['F'].min():.4f}, {ssp585_drl['F'].max():.4f}]")
print(f"F(0) = {ssp585_drl['F'].iloc[0]:.4f}, F(last) = {ssp585_drl['F'].iloc[-1]:.4f}")

# NRI city table
nri = pd.read_csv(files["nri"])
print(f"\n=== NRI graph values ===")
if "graph" in nri.columns:
    print(nri["graph"].unique())
    print(f"G1_full rows: {len(nri[nri['graph']=='G1_full'])}")

# GPKG quick
import geopandas as gpd
gdf = gpd.read_file(r"E:\大论文数据处理\26年重新计算\流域划分\output\流域单元划分\BTH_watersheds_final.gpkg")
print(f"\n=== GPKG ===")
print(f"cols: {list(gdf.columns)}")
print(f"rows: {len(gdf)}")
print(f"crs: {gdf.crs}")
print(f"watershed_id range: {gdf['watershed_id'].min()} - {gdf['watershed_id'].max()}")
print(f"main_city samples: {gdf['main_city'].unique()[:5]}")
