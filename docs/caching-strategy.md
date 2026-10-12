# 缓存策略（Redis）

目标：在「高并发会话读取 + 工具结果复用」场景下，规避经典三大缓存故障。实现见 `src/cache/cache.service.ts` 的 `getOrSet`。

## 1) 缓存雪崩 → 随机 TTL

大量 key 同一时刻失效会瞬间压垮 PostgreSQL。`getOrSet` 采用：

```
ttl = base + random(0, jitter)
```

默认 `base=60s, jitter=15s`，把失效时刻打散，避免集体击穿。

## 2) 缓存穿透 → 空值缓存

查询不存在的数据（误打的用户 / 不存在的会话）会一路打到 DB。`getOrSet` 对 `null / undefined` 结果写入短 TTL 的 `__NULL__` 占位，后续命中直接返回，不回源。

## 3) 缓存击穿 → 互斥锁

热点 key 失效瞬间大量并发回源。`getOrSet` 用 `SET lockKey 1 EX 3 NX`：仅抢到锁的请求打底层，其余自旋等待结果（最多 ~1s），避免 DB 被冲垮。

## 失效策略

写操作后调用 `cache.invalidate('reply:' + sessionId)` 清会话缓存，保证读到新上下文。

## 降级建议（生产）

当前封装聚焦命中路径。生产建议在外层包裹 `try/catch`：Redis 不可用时直接 `fetcher()` 回源，避免缓存层成为单点。
