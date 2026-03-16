# Adapters Reference

Adapters convert traces from various AI frameworks into AgentProbe's native `AgentTrace` format.

## Supported Adapters

| Adapter | Source | Auto-Detect |
|---|---|:---:|
| OpenAI | OpenAI API responses | ✅ |
| Anthropic | Anthropic API responses | ✅ |
| LangChain | LangChain trace format | ✅ |
| OpenClaw | OpenClaw session traces | ✅ |
| Generic JSONL | Line-delimited JSON | ✅ |

## Auto-Detection

AgentProbe auto-detects trace formats:

```bash
agentprobe run tests.yaml  # Traces are auto-converted
```

Or convert explicitly:

```bash
agentprobe convert trace.json -o native-trace.json
```

## OpenAI Adapter

Converts OpenAI chat completion responses (including tool calls).

```json
{
  "model": "gpt-4",
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "Let me search for that.",
      "tool_calls": [{
        "function": { "name": "search", "arguments": "{\"q\":\"weather\"}" }
      }]
    }
  }],
  "usage": { "total_tokens": 150 }
}
```

## Anthropic Adapter

Converts Anthropic Messages API responses with tool use blocks.

```json
{
  "model": "claude-3-opus",
  "content": [
    { "type": "text", "text": "I'll search for that." },
    { "type": "tool_use", "name": "search", "input": { "q": "weather" } }
  ],
  "usage": { "input_tokens": 50, "output_tokens": 100 }
}
```

## LangChain Adapter

Converts LangChain's trace format including agent steps and tool invocations.

## OpenClaw Adapter

Converts OpenClaw session traces (tool calls, messages, timestamps).

## Generic JSONL Adapter

For custom formats — one JSON object per line with `type`, `tool`, `content` fields:

```jsonl
{"type":"llm","content":"I'll search for that."}
{"type":"tool","tool":"search","args":{"q":"weather"},"result":"Sunny"}
{"type":"llm","content":"The weather is sunny."}
```

## Writing a Custom Adapter

1. Create `src/adapters/myformat.ts`:

```typescript
import type { AgentTrace } from '../types';

export function detectMyFormat(input: any): boolean {
  return input?.myFormatVersion != null;
}

export function convertMyFormat(input: any): AgentTrace {
  return {
    agent: input.agent || 'unknown',
    model: input.model,
    steps: input.events.map(e => ({
      type: e.kind === 'tool' ? 'tool_call' : 'llm_call',
      tool: e.toolName,
      args: e.toolArgs,
      output: e.content,
    })),
    final_output: input.events[input.events.length - 1]?.content || '',
    total_tokens: input.tokenCount,
  };
}
```

2. Register in `src/adapters/index.ts`
3. Add tests and submit a PR
