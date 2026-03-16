# Getting Started

Get AgentProbe running in under 3 minutes.

## Install

```bash
npm install @neuzhou/agentprobe
```

Or globally:

```bash
npm install -g @neuzhou/agentprobe
```

## Write Your First Test

Create `tests/hello.test.yaml`:

```yaml
name: booking-agent
adapter: openai
model: gpt-4o

tests:
  - input: "Book a flight from NYC to London for next Friday"
    expect:
      tool_called: search_flights
      response_contains: "flight"
      no_hallucination: true
      max_steps: 5
```

## Run It

```bash
npx agentprobe run tests/hello.test.yaml
```

That's it. **4 assertions, 1 YAML file, zero boilerplate.**

## Using the TypeScript API

```typescript
import { AgentProbe } from '@neuzhou/agentprobe';

const probe = new AgentProbe({ adapter: 'openai', model: 'gpt-4o' });
const result = await probe.test({
  input: 'What is the capital of France?',
  expect: {
    response_contains: 'Paris',
    no_hallucination: true,
    latency_ms: { max: 3000 },
  },
});
console.log(result.passed ? '✅ Passed' : '❌ Failed');
```

## Environment Setup

Set your API key for the adapter you're using:

```bash
# OpenAI
export OPENAI_API_KEY=sk-...

# Anthropic
export ANTHROPIC_API_KEY=sk-ant-...

# Azure OpenAI
export AZURE_OPENAI_API_KEY=...
export AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
```

## Scaffold a New Project

```bash
agentprobe init
```

This creates a starter project with example tests and configuration.

## Check Your Setup

```bash
agentprobe doctor
```

Verifies that your environment, dependencies, and API keys are properly configured.

## What's Next

- [Writing Tests](./writing-tests.md) — Learn the full YAML test format
- [Adapters](./adapters.md) — Connect to your LLM provider
- [CLI Reference](./cli-reference.md) — All available commands
