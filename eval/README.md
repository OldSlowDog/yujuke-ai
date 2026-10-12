# 评测基准（Evaluation Benchmark）

本目录提供两套互补的评估，用来把「网页」量化成「项目」：

1. **Agent 多步任务基准**（`tasks.json` + `run_eval.py`）：评估端到端多步工具调用成功率。
2. **工具调用纠偏基准（LoRA）**：见 [`RESULTS.md`](./RESULTS.md) 与 [`../docs/lora-finetuning.md`](../docs/lora-finetuning.md)，用 ①首调命中 ②该调不调 ③不该乱调 三率量化 4B 模型的「意图→工具名」映射。

## 多步任务基准

### 任务设计

12 个真实场景任务，覆盖：文件读写、网页生成+验收、检索引用、记忆、视觉、无工具负例。每个任务含：

- `user_prompt`：给模型的输入
- `expected_tools` / `expected_sequence`：期望调用的工具集合 / 顺序
- `success_criteria`：成功判据
- `scoring`：`tool_recall` / `tool_recall+order` / `no_tool`

### 运行

```bash
cd eval

# 1) 校验任务集结构与字段（无需任何外部服务）
python run_eval.py --self-test

# 2) 对一份转录打分（transcript = {task_id: [实际工具调用序列]}）
python run_eval.py --score transcripts/example.json

# 3) 连线上工具桥跑真实评测（需可达端点 + 凭据；本仓库不含）
python run_eval.py --live --endpoint http://127.0.0.1:8798 --out results/live.json
```

`transcripts/example.json` 是一份带标注的示例转录，演示打分口径（全通过 → 100%）。

### 评分口径

- **工具召回**：`expected_tools ⊆ 实际调用集合`。
- **顺序敏感**（仅 `order_sensitive` 任务）：实际调用须含 `expected_sequence` 为子序列。
- **聚合**：任务通过率 + **首调命中率**（第一个实际调用 == 第一个期望工具），与 LoRA 三率①对齐，便于横向比较。

> `--live` 需可达的 MCP 工具桥与驱动 LLM 的调用方；本仓库文档不含任何密钥，请在本机自托管环境运行。

## 关联

- 工具桥契约：[`../docs/tool-contract.md`](../docs/tool-contract.md)
- LoRA 微调全过程：[`../docs/lora-finetuning.md`](../docs/lora-finetuning.md)
