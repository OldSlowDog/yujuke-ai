import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { AgentService } from '../agent/agent.service';
import { LlmService, LlmMessage } from '../llm/llm.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly agent: AgentService,
    private readonly llm: LlmService,
  ) {}

  private hash(s: string): string {
    return createHash('sha1').update(s).digest('hex').slice(0, 16);
  }

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

    // 先落盘用户消息
    await this.prisma.message.create({
      data: { sessionId, role: 'user', content: { text: content } as unknown as Prisma.InputJsonValue },
    });

    // 缓存键必须含消息内容哈希：否则同会话所有消息会命中首条回复（雪崩式错误）
    const key = `reply:${sessionId}:${this.hash(content)}`;
    const reply = await this.cache.getOrSet(key, () => this.agent.run(sessionId, content));

    const text = reply?.content ?? '';
    const reasoning = reply?.reasoning ?? '';
    await this.prisma.message.create({
      data: {
        sessionId,
        role: 'assistant',
        content: { text, reasoning } as unknown as Prisma.InputJsonValue,
      },
    });
    return { reply: text, reasoning };
  }

  /** 组装发送给模型的消息列表（系统提示 + 历史 + 当前用户消息） */
  private async buildMessages(sessionId: string, userMessage: string): Promise<LlmMessage[]> {
    const rows = await this.prisma.message.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
    const history: LlmMessage[] = rows.map((m) => {
      const c = (m.content as { text?: string } | null) ?? {};
      return { role: m.role as LlmMessage['role'], content: typeof c.text === 'string' ? c.text : '' };
    });
    return [{ role: 'system', content: '你是「隅居客」，一个自托管的私有 AI 助手。回答简洁、有用。' }, ...history, { role: 'user', content: userMessage }];
  }

  /**
   * SSE 流式对话：实时把模型 token 推给客户端，结束后落盘助手消息。
   * 用于演示「打字机」效果与真模型链路（笔记本 llama.cpp via frp 隧道）。
   */
  async streamReply(sessionId: string, content: string, res: Response): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // 反代（nginx）关闭缓冲

    // 先落盘用户消息
    await this.prisma.message.create({
      data: { sessionId, role: 'user', content: { text: content } as unknown as Prisma.InputJsonValue },
    });

    const messages = await this.buildMessages(sessionId, content);
    let full = '';
    let reasoningFull = '';
    try {
      for await (const chunk of this.llm.streamChat(messages)) {
        if (chunk.delta) {
          full += chunk.delta;
          res.write(`data: ${JSON.stringify({ delta: chunk.delta })}\n\n`);
        }
        if (chunk.reasoning) {
          reasoningFull += chunk.reasoning;
          res.write(`data: ${JSON.stringify({ reasoning: chunk.reasoning })}\n\n`);
        }
      }
      await this.prisma.message.create({
        data: {
          sessionId,
          role: 'assistant',
          content: { text: full, reasoning: reasoningFull } as unknown as Prisma.InputJsonValue,
        },
      });
      res.write(`event: done\ndata: {}\n\n`);
    } catch (e) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: String(e) })}\n\n`);
    } finally {
      res.end();
    }
  }
}
