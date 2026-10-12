# 部署与运行（Deployment & Run）

> 本项目为**参考实现**，仓库内不含任何生产凭证。所有密钥通过 `deploy/.env`
> 在目标机器注入，且 `.gitignore` 严格忽略 `.env`（已用 `git check-ignore` 验证）。

## 架构位置

```
上海 VPS (139.196.25.178)
├── nginx :19004  ──反代──▶ 127.0.0.1:3001 ──▶ yujuke-api 容器 (NestJS:3000)
│                                                ├── yujuke-postgres (pgvector/pgvector:pg16)
│                                                └── yujuke-redis    (Redis 7)
└── frps :18081 ──隧道──▶ 笔记本 llama.cpp :8081   ← 推理经此调用
```

推理链路复用门户既有方案：容器内访问 `172.17.0.1:18081`（docker 宿主机桥）
→ VPS 上的 frps → 隧道 → 笔记本边缘推理 llama.cpp。鉴权走 `X-Sup-Key`（与门户一致）。

## 1) 本地运行（开发）

```bash
docker compose up -d postgres redis     # 起依赖（本地 5432/6379）
cp .env.example .env
npm install && npx prisma generate && npm run build
npm run start:dev                       # => http://localhost:3000/api
```

## 2) 生产部署（VPS）

```bash
# ① 克隆（令牌仅用于本次克隆，随后剥离）
git clone https://<PAT>@github.com/OldSlowDog/yujuke-ai.git /srv/yujuke-ai
git remote set-url origin https://github.com/OldSlowDog/yujuke-ai.git   # 剥离令牌

# ② 注入真实环境变量（绝不入库）
cp deploy/.env.template deploy/.env
#   填写：POSTGRES_PASSWORD / DATABASE_URL / LLM_SUP_KEY / INTERNAL_SHARED_SECRET …

# ③ 构建并启动
cd /srv/yujuke-ai
docker compose -f deploy/docker-compose.prod.yml up -d --build

# ④ 反代（备案前 IP 直连）
cp deploy/nginx-yujuke.conf /etc/nginx/conf.d/yujuke.conf
nginx -t && systemctl reload nginx
```

> **端口注意**：宿主侧 `3000` 已被博客容器占用，故后端映射为 `127.0.0.1:3001:3000`，
> nginx 反代 `127.0.0.1:3001`。容器内服务仍监听 `3000`。

## 3) 验证

```bash
# 建会话（x-user 需在 API_AUTH_WHITELIST 白名单内）
curl -H "x-user: demo" -H "Content-Type: application/json" \
  -X POST http://139.196.25.178:19004/api/chat/sessions -d '{"title":"demo"}'

# 发消息 —— 真实模型回复（非流式）
curl -H "x-user: demo" -H "Content-Type: application/json" \
  -X POST http://139.196.25.178:19004/api/chat/sessions/<SESSION_ID>/messages \
  -d '{"content":"用一句话介绍一下你自己"}'

# 流式（SSE，打字机效果）
curl -N -H "x-user: demo" -H "Content-Type: application/json" \
  -X POST http://139.196.25.178:19004/api/chat/sessions/<SESSION_ID>/messages/stream \
  -d '{"content":"讲个很短的笑话"}'
```

## 4) 关于「gRPC 内部通信」与线上实现

`proto/inference.proto` 与 `proto/tools.proto` 描述的是**目标内部契约**：
Portal↔边缘推理走强类型流式 gRPC。

但**线上参考实现**为了能独立跑通，推理经 `LlmService` 以 **OpenAI 兼容 HTTP**
调用自托管 llama.cpp（经 frp 隧道），原因是边缘侧实际暴露的是 llama.cpp 的
HTTP 接口而非 gRPC 服务端。二者并不矛盾：

- gRPC/Protobuf 是服务间契约与流式语义的设计基线；
- HTTP 适配是当前自托管环境下对接 llama.cpp 的落地方式；
- 若日后在边缘侧部署 gRPC 推理服务，`LlmService` 可整体替换为 gRPC 客户端，
  上层 Agent/Chat 无感知。

## 环境变量

见 `.env.example` 与 `deploy/.env.template`：

- `DATABASE_URL` / `REDIS_URL` — 数据层与缓存层连接串（生产用 compose 服务名 `postgres`/`redis`）
- `LLM_UPSTREAM` / `LLM_SUP_KEY` / `LLM_MODEL` — 推理上游（frp 隧道地址、共享密钥、模型 id）
- `API_AUTH_WHITELIST` — 网页端白名单用户（由网关注入 `x-user` 头，生产须由网关签发）
- `INTERNAL_SHARED_SECRET` — 服务间共享密钥（绝不入库）
- `CACHE_DEFAULT_TTL_MS` / `CACHE_JITTER_MS` / `CACHE_NULL_TTL_MS` — 缓存三参数
- `AGENT_MAX_STEPS` / `AGENT_REPEAT_LIMIT` / `AGENT_REPEAT_HARD` — Agent 护栏
