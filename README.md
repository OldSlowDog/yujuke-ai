# 隅居客 · 消费级硬件上的自托管私有 AI 助手

> Self-hosted private AI assistant on consumer hardware — a hybrid edge+cloud stack serving a **128k-context, tool-using LLM** to **multiple web users**, fully under your own control.

[中文](./README.md) · Architecture: [`ARCHITECTURE.md`](./ARCHITECTURE.md) · Tool contract: [`docs/tool-contract.md`](./docs/tool-contract.md)

---

## 为什么做（Problem）

商用 AI 助手依赖云端，带来**隐私、成本、可用性**三方面顾虑；而主流本地部署方案往往只能**单用户**、**缺工具能力**、或**上下文太短**，难以作为日常可用的私人助手。

目标：在**一台笔记本的 GPU** 上，跑一个支持 **128k 上下文**、可**多用户**、能**调用工具**（文件、任务、检索、网页预览/截图/求值、记忆）的私有 AI 服务，并通过一台公网 VPS 安全地暴露给网页端。

## 做了什么（Solution）

混合「**边缘推理 + 云端反代**」架构：

- **边缘推理节点（笔记本）**：`llama.cpp`（`llama-server`）加载 `Qwen3.5-4B-Uncensored` Q6_K 量化 + `mmproj-F16`（视觉多模态），上下文 **128k**（`SUP_CTX_SIZE=131072`，KV 缓存 q8_0）；由 `llm-supervisor` 托管，负责自动拉起与崩溃恢复，冷启动约 **39s**。
- **云端服务层（上海 VPS）**：`nginx` 反向代理 + Docker 化的门户服务（Portal `:19001`、控制台 `:19002`）；对外只暴露 HTTPS，内部走白名单 + 密钥。
- **工具桥（MCP Bridge）**：Python 服务绑定 `:8798`（回环 + docker0），以 **REST**（非 JSON-RPC）暴露 **16–17 个工具**，用 `X-MCP-Key` + 对等 IP 白名单保护。
- **多用户聊天**：网页 `chat.html`，白名单鉴权，会话持久化；Agent 循环带重复调用守卫、上下文窗口硬上限（100 步）、分层思考，避免空回复与失控。

> 详见 [`ARCHITECTURE.md`](./ARCHITECTURE.md) 的架构图与数据流。

## 关键技术决策（Key decisions & trade-offs）

| 决策 | 选择 | 理由 / 取舍 |
|------|------|------------|
| 推理部署 | llama.cpp 本地跑，非云端 API | 隐私与零推理成本；代价是受笔记本 GPU 显存约束，需量化 |
| 上下文 | 128k + KV q8_0 | 长文档推理能力 vs 显存占用的平衡 |
| 进程模型 | `llm-supervisor` 托管 | 笔记本重启/崩溃后自动恢复；代价是冷启动 39s 空窗 |
| 工具桥 | REST + 密钥 + IP 白名单（非 JSON-RPC） | 语言无关、易审计、易限流；代价是需自建调用约定 |
| Agent 循环 | 重复守卫 + 步数硬上限 + 分层思考 | 防止模型死循环与空输出；代价是工程复杂度 |

## 结果 / 指标（Results）

- 在**笔记本 GPU** 上运行 `Qwen3.5-4B` 量化模型，经网页向**多用户**提供服务。
- **128k** 上下文、视觉多模态（mmproj）、**工具调用**闭环可用。
- 冷启动 ~**39s** 自动恢复；工具桥 **16–17** 个工具在线。
- 全链路自托管：nginx 反代、Docker、systemd/cron 编排、`X-MCP-Key` 鉴权。

## 我做了什么（What I built）

- 设计并运维一套**边缘+云端混合的 AI 推理服务栈**。
- 实现**工具调用桥**与带安全/上下文守卫的 **Agent 循环**。
- 端到端**自托管**整套基础设施（反代、容器化、计划任务、鉴权）。

## 局限与下一步（Limitations / future work）

- 单边缘节点，无高可用；VPS 备案 / TLS 待完善。
- **缺标准化评测（evaluation harness）** —— 下一步补一套 Agent 任务基准，量化多步工具调用成功率。
- 可扩展为多模型路由与负载均衡。

## 关于本仓库（Repository scope）

本仓库**只收录设计文档与架构说明**（架构图、工具契约、技术决策）。实际的部署代码（`bot/`、`scripts/` 中的自托管编排与凭证配置）**刻意不公开**——其中含服务器凭证、内网拓扑与个人基础设施细节，不适合进入版本库。本文档中的参数均以上线实测为准，密钥与凭证不在此仓库中。

## 技术栈（Tech stack）

`llama.cpp` · `Qwen` (4B Q6_K) · `mmproj` (vision) · `nginx` · `Docker` · `systemd` / `cron` · Python (MCP bridge) · Node.js (supervisor / portal) · Web (SPA chat)

## License

[MIT](./LICENSE) © oldslowdog
