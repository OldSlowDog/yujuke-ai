# 后端架构设计（Backend Design）

隅居客后端从「文档级设计」升级为 **可运行的参考实现**：NestJS 应用承载多用户会话与 Agent 编排，PostgreSQL 持久化，Redis 缓存，gRPC 承担内部服务间通信。

> 定位：技术演示与工程参考，**不涉及生产环境**（个人无法备案生成式 AI）。仓库不含任何密钥、凭证或真实用户数据。

## 技术栈定稿

| 层 | 选型 | 理由 |
|----|------|------|
| 语言 / 框架 | TypeScript + NestJS | 企业级 DI / 模块化 / 守卫 / 拦截器，展示后端工程化深度 |
| ORM | Prisma | 类型安全、迁移脚本、schema 即文档 |
| 数据库 | PostgreSQL 16 | JSONB 存半结构化消息、pgvector 向量、CTE / 窗口函数强 |
| 缓存 | Redis 7（ioredis） | 随机 TTL 防雪崩、空值防穿透、互斥锁防击穿 |
| 内部通信 | gRPC + Protobuf | 强类型、低延迟、流式 token，取代原 REST+X-Key |
| 入参校验 | class-validator / class-transformer | DTO 全局校验（whitelist + forbidNonWhitelisted） |

## 分层

```
Browser (chat.html, SPA)
   │  HTTPS
   ▼
API Gateway (nginx: TLS 终止 / 白名单 / 注入 x-user)
   │
   ▼
NestJS App (Port 3000)
 ├─ AuthModule        WhitelistGuard（白名单 + 内部共享密钥）
 ├─ ChatModule        REST: 会话 / 消息
 ├─ AgentModule       Agent 循环: 重复守卫 / 步数硬上限 / 分层思考
 ├─ CacheModule       Redis 封装（三防护）
 └─ GrpcModule        gRPC 客户端 → 推理 / 工具桥
        │                          │
        ▼                          ▼
  Edge Inference              Tool Bridge (本地)
  (llama.cpp gRPC)           (file / task / retrieval / ...)
        │
        ▼
  PostgreSQL  +  Redis
```

## 关键工程实践

- **依赖注入与模块化**：每域一个 Module；全局模块（Prisma / Cache / Grpc）通过 `exports` 共享，避免散弹式导入。
- **守卫与管道**：`WhitelistGuard` 鉴权；`ValidationPipe` 全局 DTO 校验，杜绝越权字段。
- **迁移优先**：`prisma migrate` 管理 schema 演进，杜绝手工改表；`schema.prisma` 即数据契约。
- **连接池与优雅关闭**：`PrismaService` 实现 `OnModuleInit/Destroy`；生产前置 pgBouncer 控制连接数。
- **缓存降级**：Redis 不可用时应在外层 `try/catch` 直接回源（封装聚焦命中路径，见 caching-strategy.md）。
