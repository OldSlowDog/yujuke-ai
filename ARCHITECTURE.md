# 架构（Architecture）

隅居客是一个**混合「边缘推理 + 云端反代」**的私有 AI 助手服务栈。推理发生在用户的笔记本（边缘），网页入口与多用户服务经由一台公网 VPS（云端）安全暴露。后端已从文档级设计升级为**可运行参考实现**（NestJS + PostgreSQL + Redis + 推理客户端），并已部署线上实例（VPS `:19004`），详见 [`docs/backend-design.md`](./docs/backend-design.md) 与 [`docs/deployment.md`](./docs/deployment.md)。

> **关于 gRPC**：`proto/` 中的 gRPC/Protobuf 是**目标内部契约**（强类型流式）。线上参考实现为能独立跑通，
> 推理经 `LlmService` 以 OpenAI 兼容 HTTP 调自托管 llama.cpp（经 frp 隧道），因为边缘侧实际只暴露
> llama.cpp 的 HTTP 接口。若日后在边缘部署 gRPC 推理服务，可直接替换 `LlmService`，上层无感知。

> 定位：技术演示与工程参考，**不涉及生产环境**（个人无法备案生成式 AI）。仓库不含任何密钥、凭证或真实用户数据。

## 架构图

![architecture](./assets/architecture.svg)

## 组件分层

### 1. 客户端（Browser）
普通网页 `chat.html`（SPA），白名单鉴权；会话状态持久化在服务器端。

### 2. 云端服务层（Shanghai VPS）
| 组件 | 说明 |
|------|------|
| `nginx` | 反向代理 + TLS 终止；对外只暴露 HTTPS，内部走白名单 + 密钥 |
| Portal `:19001` | Docker 化的门户服务，承载聊天页、用户会话、工具调用编排 |
| Console `:19002` | 内网管理控制台（TOTP 保护，仅内网可达） |
| **yujuke-api `:19004`** | **本仓库后端参考实现的线上实例**：nginx → `127.0.0.1:3001` → NestJS 容器，含 PostgreSQL + Redis |

> 备案完成前只能 IP 直连，故对外端口为 `:19004`（宿主 `3000` 已被博客容器占用，
> 后端映射为 `127.0.0.1:3001:3000`）。部署步骤见 [`docs/deployment.md`](./docs/deployment.md)。

### 3. 后端应用层（NestJS，参考实现）
| 模块 | 职责 |
|------|------|
| `AuthModule` | `WhitelistGuard`：白名单用户 + 内部共享密钥 |
| `ChatModule` | REST：`POST /chat/sessions`、`POST /chat/sessions/:id/messages`（DTO 校验） |
| `AgentModule` | Agent 循环：重复调用守卫 / 步数硬上限(100) / 写成功清非写计数 |
| `CacheModule` | Redis 封装：随机 TTL 防雪崩 / 空值防穿透 / 互斥锁防击穿 |
| `LlmModule` | 推理客户端（`LlmService`）：非流式 `chat()` 与 SSE `streamChat()`，分离思维链 `reasoning` |
| `GrpcModule` | **目标契约**（未接线）：`proto/inference.proto` / `tools.proto` 定义强类型流式 gRPC |

### 4. 数据层（PostgreSQL + Prisma）
- `User / Session / Message(JSONB) / ToolCall / KnowledgeChunk(vector) / EvalRun`。
- Prisma 管理迁移与类型安全 client；JSONB 存半结构化消息，pgvector 存知识块向量。
- 详见 [`docs/data-model.md`](./docs/data-model.md)。

### 5. 缓存层（Redis）
- 会话回复、工具结果复用；三防护见 [`docs/caching-strategy.md`](./docs/caching-strategy.md)。

### 6. Agent 循环（Portal 内）
- 接收用户消息 → 调用边缘推理 → 解析工具调用意图。
- **安全/稳定性守卫**：
  - 重复调用守卫（同一工具+同参数第 3 次拒、第 5 次判 stuck）
  - 上下文窗口硬上限（100 步）
  - 轮内上下文护栏（最近 20 条消息，防爆窗）
  - 分层思考（首轮规划、中间轮执行）

### 7. 边缘推理节点（Laptop，本地 GPU）
- `llama.cpp`（`llama-server`）加载：
  - `Qwen3.5-4B-Uncensored` Q6_K 量化
  - `mmproj-F16`（视觉多模态）
- 上下文 **128k**（`SUP_CTX_SIZE=131072`，KV 缓存 q8_0）。
- `llm-supervisor` 托管：自动拉起、崩溃恢复；冷启动约 **39s**。

### 8. 工具桥（MCP Bridge，`python`，`:8798` → gRPC 化）
- 原 REST + `X-MCP-Key` + IP 白名单，已演进为 **gRPC + Protobuf**（强类型、流式），参见 [`docs/internal-protocol.md`](./docs/internal-protocol.md)。
- 暴露 **16–17 个工具**：文件读写/编辑、待办、网页预览/截图/求值、记忆、分享、视觉分析等。

## 数据流（Data flow）

```
浏览器 ──HTTPS(:19001)──▶ 上海 VPS (nginx → Portal/NestJS)
                                   │
                                   ├─▶ AuthModule (白名单)
                                   ├─▶ ChatModule (REST + SSE)
                                   ├─▶ AgentModule (循环)
                                   │     ├─▶ LlmService ─HTTP(OpenAI 兼容)─▶ frps:18081 ─隧道─▶ 笔记本 llama-server
                                   │     └─▶ 进程内工具注册表（get_time / calculator）
                                   ├─▶ CacheModule (Redis: 三防护)
                                   └─▶ Prisma ▶ PostgreSQL (持久化 + 向量检索)
```

- 用户消息经 VPS 进入 Agent 循环。
- 需要推理时，由 `LlmService` 以 OpenAI 兼容 HTTP 经 **frp 隧道**（`172.17.0.1:18081`）
  转发至笔记本 `llama-server`（流式 token）；鉴权 `X-Sup-Key`，与门户同一密钥体系。
- 需要工具时，当前执行进程内轻量工具（`get_time` / `calculator`），
  生产可替换为 gRPC `ToolBridge`（契约见 `proto/tools.proto`）。
- 会话/消息落 PostgreSQL，热点走 Redis。
- 最终响应经 VPS 回传浏览器。

## 为什么是混合架构

| 关注点 | 放在边缘（笔记本） | 放在云端（VPS） |
|--------|--------------------|------------------|
| 推理 | ✅ 隐私数据不出本机、零推理成本 | — |
| 多用户入口 | — | ✅ 稳定公网 IP、TLS、白名单 |
| 工具执行 | ✅ 直接访问本地文件/进程 | — |
| 鉴权/反代 | — | ✅ 统一网关、限流、审计 |
| 持久化 | — | ✅ PostgreSQL 关系模型 + 向量；Redis 缓存加速 |
| 服务间通信 | ✅ gRPC 强类型流式（**目标契约**；当前推理以 HTTP 适配 llama.cpp） | ✅ 反代与隧道汇聚 |
