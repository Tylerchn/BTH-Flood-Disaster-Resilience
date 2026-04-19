# -*- coding: utf-8 -*-
import json, os, sys
sys.stdout.reconfigure(encoding='utf-8')

PATH = r"E:\大论文数据处理\26年重新计算\Github_Platform\bth-resilience-dashboard\public\watershed_data.json"
print(f"文件路径: {PATH}")
print(f"文件存在: {os.path.exists(PATH)}")
print(f"文件大小: {os.path.getsize(PATH)/1024:.1f} KB")
print(f"修改时间: {os.path.getmtime(PATH)}\n")

with open(PATH, encoding='utf-8') as f:
    data = json.load(f)

print(f"=== 顶层键 ===\n{list(data.keys())}")
print(f"\n=== meta ===\n{json.dumps(data['meta'], ensure_ascii=False, indent=2)}")

units = data["watersheds"]
print(f"\n=== 汇水单元总数: {len(units)} ===")

# 第1个单元
print("\n=== 第1个汇水单元 (id=0, wsId=1) ===")
print(json.dumps(units[0], ensure_ascii=False, indent=2))

# repairOrder=0 的单元（DRL最优首修，应该是天津某单元）
first_repair = [u for u in units if u["repairOrder"] == 0][0]
print(f"\n=== DRL 首修单元 (repairOrder=0) ===")
print(json.dumps(first_repair, ensure_ascii=False, indent=2))

# 第44个单元（index=43，spec里提到"天津某单元"）
print(f"\n=== 第44个单元 (id=43, wsId=44) ===")
u44 = [u for u in units if u["id"] == 43][0]
print(json.dumps(u44, ensure_ascii=False, indent=2))

# 恢复曲线头尾
rc = data["recoveryCurve"]
print(f"\n=== 恢复曲线 (长度 {len(rc)}) ===")
print(f"前5个: {rc[:5]}")
print(f"后5个: {rc[-5:]}")
print(f"F(0)={rc[0]}, F(末)={rc[-1]}")

gc = data.get("greedyCurve", [])
print(f"\n=== 贪心对照曲线 (长度 {len(gc)}) ===")
if gc:
    print(f"前5个: {gc[:5]}")
    print(f"后5个: {gc[-5:]}")

cities = data["cities"]
print(f"\n=== 城市级NRI (共 {len(cities)} 个) ===")
for c in cities:
    print(f"  idx={c['idx']:2d}  {c['name']:4s}  NRI={c['nri']:.4f}  NRI_norm={c['nriNorm']:.4f}")

# cityIdx 检查：每个城市的 cityIdx 应该一致
print(f"\n=== cityIdx 一致性检查 ===")
city_idx_check = {}
for u in units:
    city_idx_check.setdefault(u["cityName"], set()).add(u["cityIdx"])
for name, idxs in sorted(city_idx_check.items(), key=lambda kv: list(kv[1])[0]):
    status = "✅" if len(idxs) == 1 else "❌多值"
    print(f"  {status} {name}: cityIdx={sorted(idxs)}")
