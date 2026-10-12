# 隅居客后端 · 多阶段构建
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# 复制含 prisma CLI 的完整依赖（db push 需要）；生产可改为仅 prodDependencies
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/proto ./proto
EXPOSE 3000
# 启动时同步 schema 到库（首次建表 + pgvector 扩展已在 postgres-init 创建）
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/main.js"]
