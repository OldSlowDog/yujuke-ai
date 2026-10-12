import { Injectable, Logger } from '@nestjs/common';

export type LlmRole = 'system' | 'user' | 'assistant' | 'tool';

export interface LlmMessage {
  role: LlmRole;
  content: string;
}

export interface LlmResult {
  /** 最终回答（reasoning 思考之外的可见文本） */
  content: string;
  /** 模型思维链（reasoning_content），用于审计/可解释性 */
  reasoning: string;
}

export interface LlmChunk {
  /** 增量可见文本 */
  delta: string;
  /** 增量思维链 */
  reasoning: string;
}

/**
 * 推理客户端：对接自托管 llama.cpp（OpenAI 兼容 HTTP）。
 *
 * 设计说明：
 *  - `proto/inference.proto` 中定义的 gRPC `InferenceService` 是「目标内部契约」：
 *    生产环境 Portal↔边缘推理走强类型流式 gRPC。本参考实现为可独立运行，
 *    直接以 OpenAI 兼容 HTTP 调用笔记本上的 llama.cpp（经 frp 隧道 172.17.0.1:18081），
 *    并复用与门户一致的 `X-Sup-Key` 共享密钥鉴权。
 *  - llama.cpp 输出带 `reasoning_content`（思维链），本服务把思维链与正式回答分离暴露。
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly upstream = process.env.LLM_UPSTREAM ?? 'http://172.17.0.1:18081';
  private readonly supKey = process.env.LLM_SUP_KEY ?? '';
  private readonly model = process.env.LLM_MODEL ?? 'local';
  private readonly maxTokens = Number(process.env.LLM_MAX_TOKENS ?? 768);
  private readonly temperature = Number(process.env.LLM_TEMPERATURE ?? 0.6);

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.supKey) h['X-Sup-Key'] = this.supKey;
    return h;
  }

  private extract(data: unknown): LlmResult {
    const choice = (data as { choices?: Array<{ message?: { content?: string; reasoning_content?: string } }> })?.choices?.[0];
    const msg = choice?.message ?? {};
    return { content: msg.content ?? '', reasoning: msg.reasoning_content ?? '' };
  }

  /** 非流式：返回完整结果（agent 循环使用） */
  async chat(messages: LlmMessage[], opts?: { maxTokens?: number }): Promise<LlmResult> {
    const body = {
      model: this.model,
      messages,
      max_tokens: opts?.maxTokens ?? this.maxTokens,
      temperature: this.temperature,
      stream: false,
    };
    const res = await fetch(`${this.upstream}/v1/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      this.logger.error(`llm upstream ${res.status}: ${txt.slice(0, 200)}`);
      throw new Error(`LLM upstream ${res.status}`);
    }
    return this.extract(await res.json());
  }

  /**
   * 流式：异步生成器逐块产出 token（思维链与正式文本分离）。
   * 用于 REST SSE 端点，实现「打字机」实时效果。
   */
  async *streamChat(messages: LlmMessage[], opts?: { maxTokens?: number }): AsyncGenerator<LlmChunk> {
    const body = {
      model: this.model,
      messages,
      max_tokens: opts?.maxTokens ?? this.maxTokens,
      temperature: this.temperature,
      stream: true,
    };
    const res = await fetch(`${this.upstream}/v1/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) {
      const txt = await res.text().catch(() => '');
      throw new Error(`LLM upstream ${res.status}: ${txt.slice(0, 200)}`);
    }
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (payload === '[DONE]') return;
        try {
          const json = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }>;
          };
          const delta = json.choices?.[0]?.delta ?? {};
          yield { delta: delta.content ?? '', reasoning: delta.reasoning_content ?? '' };
        } catch {
          // 忽略尚未完整的分片
        }
      }
    }
  }
}
