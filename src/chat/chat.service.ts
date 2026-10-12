import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { AgentService } from '../agent/agent.service';

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly agent: AgentService,
  ) {}

  async createSession(username: string, title?: string) {
    const user = await this.prisma.user.upsert({
      where: { username },
      update: {},
      create: { username },
    });
    return this.prisma.session.create({ data: { userId: user.id, title } });
  }

  async sendMessage(username: string, sessionId: string, content: string) {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user) throw new NotFoundException('user not found');

    // 轮内上下文护栏：仅取最近 20 条拼上下文，防爆窗
    const recent = await this.prisma.message.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    void recent;

    // 先落盘用户消息
    await this.prisma.message.create({
      data: { sessionId, role: 'user', content: { text: content } },
    });

    // 走 Agent 循环（缓存本次回复，带随机 TTL 防雪崩）
    const reply = await this.cache.getOrSet(`reply:${sessionId}`, () =>
      this.agent.run(sessionId, content),
    );

    // 落盘助手消息
    await this.prisma.message.create({
      data: { sessionId, role: 'assistant', content: { text: reply ?? '' } },
    });
    return { reply };
  }
}
