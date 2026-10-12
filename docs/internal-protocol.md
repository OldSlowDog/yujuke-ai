# 内部通信协议（gRPC）

Portal 编排层与「边缘推理」「本地工具桥」之间，由原 REST + `X-MCP-Key` 改为 **gRPC + Protobuf**：强类型、低延迟、原生支持流式。

## 推理服务 `inference.proto`

```proto
service Inference {
  rpc StreamChat(StreamChatRequest) returns (stream StreamChatResponse);
}
```

- 请求带 `session_id / user_message / tools / ctx_size`。
- 响应为 `stream`，`oneof event`：`token`(增量) / `tool_call`(模型请求工具) / `done`。
- 流式 token 天然契合 LLM 增量输出，前端可用 SSE / WebSocket 透传。

## 工具桥 `tools.proto`

```proto
service ToolBridge { rpc Call(CallRequest) returns (CallResponse); }
```

- `CallRequest{ name, arguments_json }` / `CallResponse{ is_error, content_json }`。
- 取代原 REST `POST /tools/call`，保留「工具名逐字一致」「失败不产出来源」契约。

## 为什么 gRPC 而非 REST

| 维度 | REST | gRPC |
|------|------|------|
| 类型 | 弱（JSON 约定） | 强（.proto 编译校验） |
| 流式 | 需 SSE / WS 额外封装 | 原生 `stream` |
| 性能 | 文本 JSON | Protobuf 二进制 |
| 跨语言 | 需各自解析 | 同一 `.proto` 生成多语言 client |

## Agent 循环中的调用

`agent.service.ts`：`inference().streamChat(...)` 收集 token / 工具意图 → 命中工具则 `tools().call(...)` → 结果回填上下文继续下一轮，直至模型不再请求工具或达步数硬上限（100）。
