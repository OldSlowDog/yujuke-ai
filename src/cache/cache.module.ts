import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';
import { CacheService } from './cache.service';

@Global()
@Module({
  providers: [
    {
      provide: 'REDIS',
      useFactory: () => {
        const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
        return new Redis(url, {
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
          // 连接池/重连策略；生产可加 sentinel 或 cluster 配置
        });
      },
    },
    {
      provide: CacheService,
      useFactory: (redis: Redis) => new CacheService(redis),
      inject: ['REDIS'],
    },
  ],
  exports: [CacheService],
})
export class CacheModule {}
