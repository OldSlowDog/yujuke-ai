import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService, LlmMessage, LlmResult } from '../llm/llm.service';
import { Prisma } from '@prisma/client';

interface ParsedTool {
  name: string;
  args: string;
}

interface ToolResult {
  isError: boolean;
  result: Record<string, unknown>;
}

const SYSTEM_PROMPT =
  '你是「隅居客」，一个自托管的私有 AI 助手。回答简洁、有用。' +
  '若需要调用工具，请以如下格式输出：\n```json\n{"tool":"<名称>","arguments":{}}\n```\n' +
  '可用工具：get_time（无参数，返回当前时间）、calculator（参数 {"expr":"1+1"}，计算表达式）。';

/**
 * Agent 循环：编排「推理 ↔ 工具」。集成红线索引里的安全/稳定性守卫：
 *  - 重复调用守卫：同工具+同参数第 repeatLimit 次拒、第 repeatHard 次判 stuck
 *  - 步数硬上限 maxSteps（防爆窗）
 *  - 写类工具成功 → 清除非写类历史计数（避免误伤后续操作）
 *
 * 推理经 LlmService 走 OpenAI 兼容 HTTP 调自托管 llama.cpp；工具执行当前为进程内
 * 轻量注册表（get_time/calculator），生产可替换为 gRPC ToolBridge（见 proto/tools.proto）。
 */
@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private readonly maxSteps = Number(process.env.AGENT_MAX_STEPS ?? 100);
  private readonly repeatLimit = Number(process.env.AGENT_REPEAT_LIMIT ?? 3);
  private readonly repeatHard = Number(process.env.AGENT_REPEAT_HARD ?? 5);

  private readonly repeatCounts = new Map<string, number>();
  private readonly writeRe = /write|edit|create|update|delete|mkdir/i;
  private readonly ctxWindow = Number(process.env.AGENT_CTX_MESSAGES ?? 20);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

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

  /** 解析模型输出的工具调用标记（```json 围栏） */
  private parseTool(text: string): ParsedTool | null {
    const m = text.match(/```json\s*(\{[\s\S]*?\})\s*```/);
    if (!m) return null;
    try {
      const obj = JSON.parse(m[1]) as { tool?: string; arguments?: unknown };
      if (obj.tool && typeof obj.tool === 'string') {
        return { name: obj.tool, args: JSON.stringify(obj.arguments ?? {}) };
      }
    } catch {
      /* 非合法 JSON，忽略 */
    }
    return null;
  }

  /** 进程内轻量工具注册表（参考实现；生产替换为 gRPC ToolBridge） */
  private async execLocalTool(tool: ParsedTool): Promise<ToolResult> {
    try {
      if (tool.name === 'get_time') {
        return { isError: false, result: { time: new Date().toISOString() } };
      }
      if (tool.name === 'calculator') {
        const { expr } = JSON.parse(tool.args || '{}') as { expr?: string };
        if (typeof expr !== 'string' || !/^[0-9+\-*/().\s]+$/.test(expr)) {
          return { isError: true, result: { error: 'invalid expression' } };
        }
        // 受限求值：仅允许算术字符
        const value = Function(`"use strict"; return (${expr});`)() as number;
        return { isError: false, result: { value } };
      }
      return { isError: true, result: { error: `unknown tool: ${tool.name}` } };
    } catch (e) {
      return { isError: true, result: { error: String(e) } };
    }
  }

  /** 载入最近 N 条历史，组装成 LlmMessage */
  private async loadHistory(sessionId: string): Promise<LlmMessage[]> {
    const rows = await this.prisma.message.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      take: this.ctxWindow,
    });
    return rows.map((m) => {
      const c = (m.content as { text?: string } | null) ?? {};
      const text = typeof c.text === 'string' ? c.text : '';
      return { role: m.role as LlmMessage['role'], content: text };
    });
  }

  async run(sessionId: string, userMessage: string): Promise<LlmResult> {
    const history = await this.loadHistory(sessionId);
    const messages: LlmMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history,
      { role: 'user', content: userMessage },
    ];

    let steps = 0;
    let last: LlmResult = { content: '', reasoning: '' };

    while (steps < this.maxSteps) {
      steps++;
      const out = await this.llm.chat(messages);
      last = out;

      const msg = await this.prisma.message.create({
        data: {
          sessionId,
          role: 'assistant',
          content: { text: out.content, reasoning: out.reasoning } as unknown as Prisma.InputJsonValue,
        },
      });

      const toolCall = this.parseTool(out.content);
      if (!toolCall) return out; // 模型不再请求工具，结束

      this.guardRepeat(toolCall.name, toolCall.args);
      const res = await this.execLocalTool(toolCall);
      this.clearNonWriteOnWrite(toolCall.name);

      await this.prisma.toolCall.create({
        data: {
          messageId: msg.id,
          name: toolCall.name,
          arguments: this.safeParse(toolCall.args) as unknown as Prisma.InputJsonValue,
          result: res.result as unknown as Prisma.InputJsonValue,
          isError: res.isError,
        },
      });

      messages.push({ role: 'assistant', content: out.content });
      messages.push({
        role: 'tool',
        content: `[${toolCall.name}] ${JSON.stringify(res.result)}`,
      });
    }

    this.logger.warn(`agent reached max steps (${this.maxSteps}) for session ${sessionId}`);
    return last;
  }

  private safeParse(s: string): Record<string, unknown> {
    try {
      return JSON.parse(s || '{}');
    } catch {
      return { raw: s };
    }
  }
}
