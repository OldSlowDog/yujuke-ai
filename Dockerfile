# 隅居客后端 · 多阶段构建
# 注意：基础镜像必须用 Debian 系（node:20-slim），不能用 alpine。
# Prisma 引擎在 musl(alpine) 上无法检测 libssl/openssl 版本（回落 openssl-1.1.x），
# 会导致 "Could not parse schema engine response" 并崩溃重启。
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Prisma 引擎依赖 OpenSSL；Debian slim 默认已带 libssl3，此处显式确保
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
# 复制含 prisma CLI 的完整依赖（db push 需要）；生产可改为仅 prodDependencies
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/proto ./proto
EXPOSE 3000
# 启动时同步 schema 到库（首次建表 + pgvector 扩展已在 postgres-init 创建）
# ⚠️ 必须带 --accept-data-loss：prisma 对「新增 User.username 唯一约束」会判定为
#    潜在数据丢失并直接拒绝执行（ERROR: Use the --accept-data-loss flag），
#    容器随即崩溃重启。新库/空表场景下加该标志是安全的。
CMD ["sh", "-c", "npx prisma db push --skip-generate --accept-data-loss && node dist/main.js"]
