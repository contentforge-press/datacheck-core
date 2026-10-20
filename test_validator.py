"""测试校验内核：Python 版

覆盖所有关键场景，包括那些「能解析但是错的」陷阱。
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "products", "core"))
sys.stdout.reconfigure(encoding="utf-8")

from validator import (check_date, parse_csv, parse_money, to_dict,
                       to_markdown, validate)

PASS = FAIL = 0
FAILURES = []


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  PASS  {name}")
    else:
        FAIL += 1
        FAILURES.append((name, detail))
        print(f"  FAIL  {name}  {detail}")


print("=" * 76)
print("校验内核测试")
print("=" * 76)

# ============================================================
print("\n[1] CSV 解析")
h, r = parse_csv("a,b,c\n1,2,3\n4,5,6")
check("表头", h == ["a", "b", "c"], str(h))
check("行数", len(r) == 2, str(len(r)))

h2, r2 = parse_csv('name,note\n"Smith, John","said ""hi"""')
check("引号内逗号", r2[0][0] == "Smith, John", str(r2[0]))
check("转义引号", r2[0][1] == 'said "hi"', str(r2[0]))

# ============================================================
print("\n[2] 日期真实性（关键陷阱）")
check("正常日期", check_date("2026-10-20")[0])
check("2月30日不存在", not check_date("2026-02-30")[0])
check("13月不存在", not check_date("2026-13-01")[0])
check("闰年2月29", check_date("2024-02-29")[0])
check("非闰年2月29不存在", not check_date("2025-02-29")[0])
check("斜杠格式", check_date("2026/10/20")[0])
check("紧凑格式", check_date("20261020")[0])
check("空值放行", check_date("")[0])

# ============================================================
print("\n[3] 金额解析")
ok, v = parse_money("$1,250.00")
check("美元逗号", ok and v == 1250.0, f"{ok} {v}")
ok, v = parse_money("(1,300)")
check("括号负数", ok and v == -1300.0, f"{ok} {v}")
ok, v = parse_money("1.2k")
check("k 后缀", ok and v == 1200.0, f"{ok} {v}")
ok, v = parse_money("abc")
check("非数字拒绝", not ok, f"{ok}")

# ============================================================
print("\n[4] 完整校验")
CSV = """order_id,customer,email,amount,status,date
A-1001,John Smith,JOHN@Example.COM ,"$1,250.00",paid,2026/10/01
A-1002,emma watson,emma@shop.co,890,PAID,10/02/2026
A-1002 ,Emma  Watson,emma@shop.co,890,paid,2026-10-02
A-1003,ROBERT brown,N/A,"$2,400",refunded,2026/10/3
A-1004,Maria Garcia,maria@example.com,,paid,2026/10/4
A-1005,  li wei  ,LI.WEI@corp.cn,"(1,300)",completed,20261005
A-1006,Bob,,12.5,success,2026/13/45"""

res = validate(CSV, required_columns=["email"], key_column="order_id")
d = to_dict(res)

check("总分在合理范围", 0 <= d["score"] <= 100, str(d["score"]))
check("识别行数", d["total_rows"] == 7, str(d["total_rows"]))
check("有高危问题", d["counts"]["high"] > 0, str(d["counts"]))
check("发现 13 月", any(i["type"] in ("invalid_date", "impossible_date")
                        and "2026/13/45" in i["value"] for i in d["issues"]),
      "13月未被识别")
check("发现 N/A 占位符", any(i["type"] == "placeholder_value"
                              for i in d["issues"]))
check("发现必填为空", any(i["type"] == "empty_required"
                          for i in d["issues"]))
check("有丢失行统计", len(d["lossy_rows"]) > 0, str(d["lossy_rows"]))
check("有问题清单", len(d["issues"]) > 5, str(len(d["issues"])))
check("有列画像", len(d["columns"]) == 6, str(len(d["columns"])))

# 列类型推断
cols = {c["name"]: c["inferred_type"] for c in d["columns"]}
check("date 列识别为日期", cols.get("date") == "date", str(cols.get("date")))
check("amount 列识别为金额/数字",
      cols.get("amount") in ("money", "number"), str(cols.get("amount")))

# ============================================================
print("\n[5] 干净数据")
CLEAN = """id,name,amount
1,Alice,100
2,Bob,200
3,Carol,300"""
r2 = validate(CLEAN)
check("干净数据高分", r2.score >= 95, str(r2.score))
check("干净数据无高危", r2.counts["high"] == 0, str(r2.counts))

# ============================================================
print("\n[6] 主键重复")
DUP = """id,val
A-001,x
A-1,y
A-002,z"""
r3 = validate(DUP, key_column="id")
# A-001 和 A-1 去掉前导零后都是 "a-1"
check("识别主键重复", any(i.type == "duplicate_key" for i in r3.issues),
      str([i.type for i in r3.issues]))

# ============================================================
print("\n[7] 报告输出")
md = to_markdown(res)
check("Markdown 有标题", "# Data Health Report" in md)
check("Markdown 有分数", "Score:" in md)
check("Markdown 有表格", "| Row | Column |" in md)

# ============================================================
print("\n[8] 边界情况")
check("空输入不崩", validate("").score == 100)
check("只有表头", validate("a,b,c").total_rows == 0)
check("单行数据", validate("a,b\n1,2").total_rows == 1)

print("\n" + "=" * 76)
print(f"结果: {PASS} 通过, {FAIL} 失败")
print("=" * 76)
if FAILURES:
    print("\n失败详情:")
    for n, det in FAILURES:
        print(f"  · {n}: {det}")

# 输出样例报告供检查
print("\n" + "=" * 76)
print("样例报告输出")
print("=" * 76)
print(md[:1500])

sys.exit(0 if FAIL == 0 else 1)
