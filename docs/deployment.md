# 本地运行（Local Run）

> 本项目为参考实现，不含任何生产凭证；以下均使用 `.env.example` 占位。

## 1) 起依赖

```bash
docker compose up -d postgres redis
cp .env.example .env
```

## 2) 装依赖 + 迁移

```bash
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run prisma:seed
```

## 3) 启动

```bash
npm run start:dev
# => http://localhost:3000/api
```

## 4) 调接口（需白名单用户，由网关注入 x-user 头）

```bash
curl -H "x-user: alice" -X POST localhost:3000/api/chat/sessions \
  -H "Content-Type: application/json" -d '{"title":"demo"}'
```

## 环境变量

见 `.env.example`：

- `DATABASE_URL` / `REDIS_URL` — 数据层与缓存层连接串
- `GRPC_INFERENCE_URL` / `GRPC_TOOLS_URL` — 内部 gRPC 端点
- `API_AUTH_WHITELIST` — 网页端白名单用户（逗号分隔）
- `INTERNAL_SHARED_SECRET` — 服务间共享密钥（生产由环境变量注入，绝不入库）
- `CACHE_DEFAULT_TTL_MS` / `CACHE_JITTER_MS` / `CACHE_NULL_TTL_MS` — 缓存三参数
- `AGENT_MAX_STEPS` / `AGENT_REPEAT_LIMIT` / `AGENT_REPEAT_HARD` — Agent 护栏
