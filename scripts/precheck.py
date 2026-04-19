# -*- coding: utf-8 -*-
import os, pandas as pd

files_to_check = {
    "汇水单元矢量": r"E:\大论文数据处理\26年重新计算\流域划分\output\流域单元划分\BTH_watersheds_final.gpkg",
    "韧性基座表": r"E:\大论文数据处理\26年重新计算\第六章v3\ch6_watershed_resilience_v5.csv",
    "灾损向量表": r"E:\大论文数据处理\26年重新计算\第六章v3\ch6_damage_vectors_v5.csv",
    "AEL结果表": r"E:\大论文数据处理\26年重新计算\第六章v3\ch6_AEL_results_v5.csv",
    "DRL修复序列": r"E:\大论文数据处理\26年重新计算\第六章v3\drl_results_v7\recovery_sequences.csv",
    "DRL恢复曲线": r"E:\大论文数据处理\26年重新计算\第六章v3\drl_results_v7\recovery_curves.csv",
    "三层网络汇总": r"E:\大论文数据处理\26年重新计算\第六章v3\networks\road_watershed_summary.csv",
    "城市NRI表": r"E:\大论文数据处理\python_codes\网络韧性\fig_v7_improved\tables\city_NRI_G1_G2.csv",
}

for name, path in files_to_check.items():
    exists = os.path.exists(path)
    if exists and path.endswith('.csv'):
        try:
            df = pd.read_csv(path)
            print(f"OK  {name}: {path}")
            print(f"    rows={len(df)}, cols={list(df.columns)[:8]}{'...' if len(df.columns)>8 else ''}")
        except Exception as e:
            print(f"ERR {name}: read failed - {e}")
    elif exists:
        print(f"OK  {name}: {path}")
    else:
        print(f"MISS {name}: {path}")
