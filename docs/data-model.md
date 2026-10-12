# 数据模型（Data Model）

## ER 概览

```
User 1──* Session 1──* Message 1──* ToolCall
                                      │
                                      └─ 评测/审计联动
KnowledgeChunk (向量)   EvalRun
```

## 表说明

- **User**：`id(uuid)`, `username(unique)`, `createdAt`。白名单用户首次会话时 `upsert`。
- **Session**：`id`, `userId→User`, `title?`, 时间戳。一次对话的上下文边界。
- **Message**：`id`, `sessionId→Session`, `role('user'|'assistant'|'tool')`, `content Json(JSONB)`。
  - 用 **JSONB 而非多列**：消息体含文本、工具结果、引用来源徽标等半结构化数据，schema 演进零成本。
- **ToolCall**：`id`, `messageId→Message`, `name`, `arguments Json`, `result Json?`, `isError`, 时间戳。独立表便于评测三率（首调命中 / 该调不调 / 不该乱调）与审计。
- **KnowledgeChunk**：`id`, `source`, `text`, `embedding vector(1536)?`（pgvector）。供记忆 / 检索做 `<->` 余弦相似度。
- **EvalRun**：`id`, `taskId`, `passed`, `toolRecall`, `firstHit`, `raw Json`。口径对齐 `eval/` 基准。

## 迁移

```bash
npx prisma migrate dev --name init   # 生成并应用 SQL 迁移
npx prisma generate                  # 生成类型安全 client
```

向量列需数据库启用 `vector` 扩展（已含在迁移 SQL 中）：

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

## 检索示例（pgvector）

```sql
SELECT id, source, text
FROM "KnowledgeChunk"
ORDER BY embedding <-> $1
LIMIT 5;
```

> 注意：Prisma 对 `vector` 类型用 `Unsupported("vector(1536)")` 映射；相似度查询通过 `prisma.$queryRaw` 执行 `<->` 算子。
