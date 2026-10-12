import { Injectable, Logger } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { Inject } from '@nestjs/common';
import { firstValueFrom, Observable } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

interface InferenceStream {
  streamChat(req: Record<string, unknown>): Observable<Record<string, unknown>>;
}
interface ToolBridge {
  call(req: { name: string; arguments_json: string }): Observable<{ is_error: boolean; content_json: string }>;
}

/**
 * Agent 循环：编排「推理 ↔ 工具」。集成红线索引里的安全/稳定性守卫：
 *  - 重复调用守卫：同工具+同参数第 repeatLimit 次拒、第 repeatHard 次判 stuck
 *  - 步数硬上限 maxSteps（防爆窗）
 *  - 写类工具成功 → 清除非写类历史计数（避免误伤后续操作）
 *  - 轮内上下文护栏在 chat.service 取最近 N 条消息时体现
 */
@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private readonly maxSteps = Number(process.env.AGENT_MAX_STEPS ?? 100);
  private readonly repeatLimit = Number(process.env.AGENT_REPEAT_LIMIT ?? 3);
  private readonly repeatHard = Number(process.env.AGENT_REPEAT_HARD ?? 5);

  private readonly repeatCounts = new Map<string, number>();
  private readonly writeRe = /write|edit|create|update|delete|mkdir/i;

  constructor(
    private readonly prisma: PrismaService,
    @Inject('INFERENCE_PACKAGE') private readonly inferenceClient: ClientGrpc,
    @Inject('TOOLS_PACKAGE') private readonly toolsClient: ClientGrpc,
  ) {}

  private inference(): InferenceStream {
    return this.inferenceClient.getService('Inference') as unknown as InferenceStream;
  }
  private tools(): ToolBridge {
    return this.toolsClient.getService('ToolBridge') as unknown as ToolBridge;
  }

  /** 重复调用守卫：同工具+同参数计数 */
  private guardRepeat(tool: string, args: string): void {
    const key = `${tool}::${args}`;
    const n = (this.repeatCounts.get(key) ?? 0) + 1;
    this.repeatCounts.set(key, n);
    if (n >= this.repeatHard) throw new Error(`stuck: tool ${tool} repeated ${n} times`);
    if (n >= this.repeatLimit) {
      this.logger.warn(`repeat guard: ${tool} x${n} rejected`);
      throw new Error(`repeat limit: ${tool} x${n}`);
    }
  }

  /** 写类成功 → 清除非写类计数，避免误伤后续操作 */
  private clearNonWriteOnWrite(tool: string): void {
    if (!this.writeRe.test(tool)) return;
    for (const k of [...this.repeatCounts.keys()]) {
      if (!this.writeRe.test(k.split('::')[0])) this.repeatCounts.delete(k);
    }
  }

  private async collect(stream: Observable<Record<string, unknown>>): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    await new Promise<void>((resolve) => {
      stream.subscribe({
        next: (v) => out.push(v),
        error: () => resolve(),
        complete: () => resolve(),
      });
    });
    return out;
  }

  async run(sessionId: string, userMessage: string): Promise<string> {
    let conversation = userMessage;
    let steps = 0;

    while (steps < this.maxSteps) {
      steps++;
      const chunks = await this.collect(
        this.inference().streamChat({
          session_id: sessionId,
          user_message: conversation,
          tools: [{ name: 'file_read', description: 'read a workspace file' }],
          ctx_size: 131072,
        }),
      );

      let text = '';
      let pending: { name: string; args: string } | null = null;
      for (const c of chunks) {
        if (c.token) text += String(c.token);
        if (c.toolCall) {
          const tc = c.toolCall as { name: string; arguments_json: string };
          pending = { name: tc.name, args: tc.arguments_json };
        }
      }

      // 落盘 assistant 消息
      const msg = await this.prisma.message.create({
        data: { sessionId, role: 'assistant', content: { text } },
      });

      if (!pending) return text; // 模型不再请求工具，结束

      this.guardRepeat(pending.name, pending.args);
      const res = await firstValueFrom(
        this.tools().call({ name: pending.name, arguments_json: pending.args }),
      );
      this.clearNonWriteOnWrite(pending.name);

      const parsedArgs = this.safeParse(pending.args);
      const parsedResult = res.is_error ? null : this.safeParse(res.content_json);
      await this.prisma.toolCall.create({
        data: {
          messageId: msg.id,
          name: pending.name,
          arguments: parsedArgs as unknown as Prisma.InputJsonValue,
          result: parsedResult ? (parsedResult as unknown as Prisma.InputJsonValue) : undefined,
          isError: res.is_error,
        },
      });

      conversation = `[tool ${pending.name} result]: ${res.content_json}`;
    }

    this.logger.warn(`agent reached max steps (${this.maxSteps}) for session ${sessionId}`);
    return conversation;
  }

  private safeParse(s: string): Record<string, unknown> {
    try {
      return JSON.parse(s || '{}');
    } catch {
      return { raw: s };
    }
  }
}
