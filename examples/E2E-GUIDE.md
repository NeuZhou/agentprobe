# E2E Testing Guide with AgentProbe + Ollama

End-to-end testing of AI agents using a real local LLM (Ollama).

## Prerequisites

- [Ollama](https://ollama.ai) installed and running
- `qwen2.5:7b` model pulled: `ollama pull qwen2.5:7b`
- `npm install` in the agentprobe directory

Verify Ollama is running:
```bash
curl http://localhost:11434/api/tags
```

## What's Included

| File | Purpose |
|------|---------|
| `agents/simple-agent.ts` | Minimal calculator agent with tool calling |
| `e2e-tests.yaml` | Test suite definition |
| `run-e2e.ts` | Full E2E pipeline runner |
| `traces/e2e-calculator.json` | Generated trace (after running) |

## Quick Start

Run the full pipeline (generate trace → validate → report):

```bash
npx ts-node examples/run-e2e.ts
```

This will:
1. **Run the agent** — sends "What is 42 * 17?" to qwen2.5:7b via Ollama
2. **Record the trace** — captures LLM calls, tool calls, and outputs
3. **Show trace summary** — prints each step
4. **Run assertions** — validates tool usage, output correctness, step count

### Run Agent Standalone

```bash
# Default question
npx ts-node examples/agents/simple-agent.ts

# Custom question
npx ts-node examples/agents/simple-agent.ts "What is 123 + 456?"

# With trace recording
npx ts-node examples/agents/simple-agent.ts --record "What is 99 * 11?"
```

## How It Works

### 1. Agent Loop

The agent uses OpenAI SDK pointed at Ollama's compatible API:

```typescript
const client = new OpenAI({
  baseURL: 'http://localhost:11434/v1',
  apiKey: 'ollama',
});
```

It runs a standard tool-calling loop:
- Send messages + tool definitions to LLM
- If LLM returns tool calls → execute them → feed results back
- Repeat until LLM returns a text answer

### 2. Trace Recording

AgentProbe's `Recorder` monkey-patches the OpenAI SDK to intercept calls:

```typescript
const recorder = new Recorder({ agent: 'simple-calculator' });
recorder.patchOpenAI(require('openai'));
// ... run agent ...
recorder.save('traces/e2e-calculator.json');
```

The trace captures: `llm_call` → `tool_call` → `llm_call` → `output`

### 3. Assertions

Tests validate the trace against expectations:
- `tool_called: calculate` — the agent used the right tool
- `output_matches: "714"` — the answer is correct
- `max_steps: 10` — the agent didn't loop forever

## Example Output

```
═══ Step 1: Running agent with Ollama (qwen2.5:7b) ═══

🤖 Agent answer: The result of 42 * 17 is 714.
📝 Trace saved: examples/traces/e2e-calculator.json

═══ Step 2: Trace Summary ═══

  ID:    abc123...
  Steps: 4
  [llm_call] → qwen2.5:7b
  [tool_call] → calculate({"expression":"42 * 17"})
  [llm_call] → qwen2.5:7b
  [output] → "The result of 42 * 17 is 714."

═══ Step 3: Running Assertions ═══

  ✅ Tool "calculate" was called
  ✅ Output contains a number
  ✅ Output contains 714
  ✅ Trace has ≤ 10 steps

🎉 All checks passed!
```

## Adapting for Other Models

Change the model in `simple-agent.ts`:

```typescript
// Ollama models
model: 'llama3.1:8b'
model: 'mistral:7b'

// Or point to OpenAI/other providers
baseURL: 'https://api.openai.com/v1'
apiKey: process.env.OPENAI_API_KEY
model: 'gpt-4o-mini'
```
