import { Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';

export interface CacheOptions {
  /** 基础 TTL（毫秒），实际过期 = base + random(0, jitter) */
  ttlBaseMs?: number;
  /** 抖动上限（毫秒），用于错开过期时刻，防雪崩 */
  jitterMs?: number;
  /** 空值（穿透防护）缓存时长（毫秒） */
  nullTtlMs?: number;
}

const NULL_PLACEHOLDER = '__NULL__';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly defaultTtlBase: number;
  private readonly defaultJitter: number;
  private readonly defaultNullTtl: number;

  constructor(private readonly redis: Redis) {
    this.defaultTtlBase = Number(process.env.CACHE_DEFAULT_TTL_MS ?? 60000);
    this.defaultJitter = Number(process.env.CACHE_JITTER_MS ?? 15000);
    this.defaultNullTtl = Number(process.env.CACHE_NULL_TTL_MS ?? 5000);
  }

  /** 真实过期时间 = 基础 + 随机抖动，避免大量 key 同一时刻集体失效（防雪崩） */
  private jitteredTtl(base: number, jitter: number): number {
    return Math.floor(base + Math.random() * jitter);
  }

  /**
   * 读缓存；未命中则回源并写回。集成三道防护：
   *  1) 随机 TTL      —— 错开过期时刻，防缓存雪崩
   *  2) 空值缓存      —— 源返回 null/undefined 也短期占位，防缓存穿透到 DB
   *  3) 互斥锁(SET NX)—— 并发回源时仅一个请求打底层，其余自旋等待，防缓存击穿
   */
  async getOrSet<T>(
    key: string,
    fetcher: () => Promise<T | null | undefined>,
    opts: CacheOptions = {},
  ): Promise<T | null | undefined> {
    const ttlBase = opts.ttlBaseMs ?? this.defaultTtlBase;
    const jitter = opts.jitterMs ?? this.defaultJitter;
    const nullTtl = opts.nullTtlMs ?? this.defaultNullTtl;

    const cached = await this.redis.get(key);
    if (cached !== null) {
      if (cached === NULL_PLACEHOLDER) return null;
      try {
        return JSON.parse(cached) as T;
      } catch {
        return cached as unknown as T;
      }
    }

    // 互斥锁防击穿：仅抢到锁的请求回源
    const lockKey = `${key}:lock`;
    const acquired = await this.redis.set(lockKey, '1', 'EX', 3, 'NX');
    if (!acquired) {
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 50));
        const v = await this.redis.get(key);
        if (v !== null) {
          return v === NULL_PLACEHOLDER ? null : (JSON.parse(v) as T);
        }
      }
      this.logger.warn(`cache stampede fallback for ${key}`);
    }

    try {
      const value = await fetcher();
      if (value === null || value === undefined) {
        await this.redis.set(key, NULL_PLACEHOLDER, 'EX', Math.floor(nullTtl / 1000));
        return null;
      }
      const ttl = this.jitteredTtl(ttlBase, jitter);
      await this.redis.set(key, JSON.stringify(value), 'EX', Math.floor(ttl / 1000));
      return value;
    } finally {
      await this.redis.del(lockKey);
    }
  }

  /** 按前缀批量失效（如会话更新后清 session:* 缓存） */
  async invalidate(prefix: string): Promise<void> {
    const keys = await this.redis.keys(`${prefix}*`);
    if (keys.length) await this.redis.del(...keys);
  }
}
