# Adapters

AgentProbe connects to any LLM provider through its adapter system. Switch providers by changing one line.

## Supported Adapters

| Provider | Adapter Key | Status |
|---|---|---|
| OpenAI | `openai` | ✅ Stable |
| Anthropic | `anthropic` | ✅ Stable |
| Google (Gemini) | `google` | ✅ Stable |
| AWS Bedrock | `bedrock` | ✅ Stable |
| Azure OpenAI | `azure` | ✅ Stable |
| Cohere | `cohere` | ✅ Stable |
| LangChain | `langchain` | ✅ Stable |
| OpenClaw | `openclaw` | ✅ Stable |
| Generic HTTP | `http` | ✅ Stable |
| Ollama | `ollama` | ✅ Stable |
| Custom | `custom` | ✅ Stable |

## OpenAI

```yaml
adapter: openai
model: gpt-4o
```

**Environment:** `OPENAI_API_KEY`

```bash
export OPENAI_API_KEY=sk-...
```

## Anthropic

```yaml
adapter: anthropic
model: claude-sonnet-4-20250514
```

**Environment:** `ANTHROPIC_API_KEY`

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

## Google (Gemini)

```yaml
adapter: google
model: gemini-2.0-flash
```

**Environment:** `GOOGLE_API_KEY`

```bash
export GOOGLE_API_KEY=...
```

## AWS Bedrock

```yaml
adapter: bedrock
model: anthropic.claude-3-sonnet
region: us-east-1
```

**Environment:** Standard AWS credentials (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`)

## Azure OpenAI

```yaml
adapter: azure
model: gpt-4o
endpoint: https://your-resource.openai.azure.com
deployment: your-deployment-name
api_version: "2024-06-01"
```

**Environment:**

```bash
export AZURE_OPENAI_API_KEY=...
export AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
```

## Cohere

```yaml
adapter: cohere
model: command-r-plus
```

**Environment:** `COHERE_API_KEY`

## LangChain

```yaml
adapter: langchain
chain: your-chain-config
```

Works with any LangChain-compatible chain or agent configuration.

## OpenClaw

```yaml
adapter: openclaw
model: gpt-4o
```

Tests agents running inside the OpenClaw framework.

## Ollama

```yaml
adapter: ollama
model: llama3
endpoint: http://localhost:11434
```

No API key needed — runs locally.

## Generic HTTP

Connect to any HTTP endpoint:

```yaml
adapter: http
endpoint: https://my-agent.internal/api/chat
headers:
  Authorization: "Bearer your-token"
  Content-Type: "application/json"
request_format:
  message_field: "input"
response_format:
  content_field: "response"
```

## Custom Adapter (TypeScript)

Build your own adapter:

```typescript
import { AgentProbe, Adapter, AdapterResponse } from '@neuzhou/agentprobe';

class MyAdapter implements Adapter {
  async send(input: string, options: any): Promise<AdapterResponse> {
    const response = await myCustomLLM.chat(input);
    return {
      content: response.text,
      tool_calls: response.tools || [],
      latency_ms: response.duration,
      cost_usd: response.cost,
    };
  }
}

const probe = new AgentProbe({
  adapter: new MyAdapter(),
});
```

## Adapter Configuration

All adapters support these common options:

```yaml
adapter: openai
model: gpt-4o

adapter_config:
  temperature: 0.0          # Deterministic for testing
  max_tokens: 4096
  timeout_ms: 30000
  retries: 2
  retry_delay_ms: 1000
```

## Switching Adapters

Run the same tests against different providers:

```bash
# Test with OpenAI
agentprobe run tests/ --adapter openai --model gpt-4o

# Same tests with Anthropic
agentprobe run tests/ --adapter anthropic --model claude-sonnet-4-20250514

# Compare results
agentprobe diff results-openai.json results-anthropic.json
```
