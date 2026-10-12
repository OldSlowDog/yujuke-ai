#!/usr/bin/env python3
"""
隅居客 Agent 多步任务基准 —— 评测 runner。

三种运行模式：
  --self-test                      校验 tasks.json 结构与字段，不依赖任何外部服务
  --score PATH                    对一份转录(JSON: {task_id: [tool_calls]})打分并打印报告
  --live --endpoint URL [--out F] 连线上 MCP 工具桥跑真实评测（需可达端点 + 凭据，本仓库不含）

评分口径（对齐 LoRA 三率）：
  - tool_recall : expected_tools ⊆ 实际调用集合
  - order       : actual 含 expected_sequence 为子序列（仅 order_sensitive 任务）
  - 聚合        : 任务通过率 + 首调命中率（第一个实际调用 == 第一个期望工具）
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TASKS_PATH = os.path.join(HERE, "tasks.json")


def load_tasks():
    with open(TASKS_PATH, encoding="utf-8") as f:
        return json.load(f)


def score_task(task, calls):
    exp = set(task.get("expected_tools", []))
    got = set(calls)
    recall = exp <= got
    order_ok = True
    if task.get("order_sensitive") and task.get("expected_sequence"):
        seq = task["expected_sequence"]
        it = iter(calls)
        order_ok = all(any(c == s for c in it) for s in seq)
    passed = recall and order_ok
    return passed, recall, order_ok


def first_call_hit(task, calls):
    exp_seq = task.get("expected_sequence") or task.get("expected_tools") or []
    if not exp_seq:
        # 无工具负例：期望不调任何工具
        return len(calls) == 0
    return bool(calls) and calls[0] == exp_seq[0]


def run_self_test():
    tasks = load_tasks()
    required = {"id", "title", "expected_tools", "expected_sequence", "scoring"}
    errors = []
    ids = set()
    for t in tasks:
        missing = required - set(t.keys())
        if missing:
            errors.append(f"{t.get('id','?')} 缺字段: {missing}")
        if t.get("id") in ids:
            errors.append(f"重复 id: {t['id']}")
        ids.add(t.get("id"))
    if errors:
        print("SELF-TEST: FAIL")
        for e in errors:
            print("  -", e)
        return 1
    print(f"SELF-TEST: OK  ({len(tasks)} 个任务, {len(ids)} 个唯一 id)")
    for t in tasks:
        print(f"  [{t['id']}] {t['title']}  expect={t['expected_tools']}  order={t.get('order_sensitive')}")
    return 0


def run_score(path):
    tasks = {t["id"]: t for t in load_tasks()}
    with open(path, encoding="utf-8") as f:
        transcript = json.load(f)

    rows = []
    pass_n = 0
    hit_n = 0
    for tid, calls in transcript.items():
        task = tasks.get(tid)
        if not task:
            print(f"  ! 未知任务 {tid}，跳过")
            continue
        passed, recall, order_ok = score_task(task, calls)
        hit = first_call_hit(task, calls)
        pass_n += int(passed)
        hit_n += int(hit)
        rows.append((tid, task["title"], passed, recall, order_ok, hit, calls))

    total = len(rows)
    print("=" * 72)
    print(f"{'ID':<5}{'任务':<22}{'通过':<6}{'召回':<6}{'顺序':<6}{'首调':<6}")
    print("-" * 72)
    for tid, title, passed, recall, order_ok, hit, calls in rows:
        print(f"{tid:<5}{title:<22}{_m(passed):<6}{_m(recall):<6}{_m(order_ok):<6}{_m(hit):<6}  {calls}")
    print("-" * 72)
    print(f"任务通过率   : {pass_n}/{total} = {pass_n/total*100:.1f}%")
    print(f"首调命中率 ① : {hit_n}/{total} = {hit_n/total*100:.1f}%")
    print("=" * 72)
    return 0


def _m(b):
    return "✅" if b else "❌"


def run_live(endpoint, out):
    # 真实评测需连 MCP 工具桥并驱动 LLM；本仓库不含凭证，此处仅说明用法。
    print("LIVE 模式需要可达的 MCP 工具桥与驱动 LLM 的调用方。")
    print(f"  端点应类似: {endpoint}")
    print("  建议实现：对每个任务把 user_prompt 发给聊天接口，")
    print("  收集本轮实际工具调用序列，写成 {task_id: [calls]}，再用 --score 打分。")
    print("  本仓库文档不含任何密钥，请在本机自托管环境运行。")
    if out:
        print(f"  (结果将写入 {out})")
    return 0


def main():
    ap = argparse.ArgumentParser(description="隅居客 Agent 多步任务基准 runner")
    ap.add_argument("--self-test", action="store_true", help="校验任务集结构")
    ap.add_argument("--score", metavar="PATH", help="对转录 JSON 打分")
    ap.add_argument("--live", action="store_true", help="连线上工具桥（需端点+凭据）")
    ap.add_argument("--endpoint", default="http://127.0.0.1:8798", help="MCP 工具桥地址")
    ap.add_argument("--out", metavar="PATH", help="live 模式结果输出路径")
    args = ap.parse_args()

    if args.self_test:
        return run_self_test()
    if args.score:
        return run_score(args.score)
    if args.live:
        return run_live(args.endpoint, args.out)
    ap.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
