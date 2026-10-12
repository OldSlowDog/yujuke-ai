import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { CacheModule } from './cache/cache.module';
import { LlmModule } from './llm/llm.module';
import { AuthModule } from './auth/auth.module';
import { AgentModule } from './agent/agent.module';
import { ChatModule } from './chat/chat.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '.env.example'] }),
    PrismaModule,
    CacheModule,
    LlmModule,
    AuthModule,
    AgentModule,
    ChatModule,
  ],
})
export class AppModule {}
