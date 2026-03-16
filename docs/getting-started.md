# Getting Started with AgentProbe

## Installation

```bash
npm install -D @neuzhou/agentprobe
```

Or globally:

```bash
npm install -g @neuzhou/agentprobe
```

## Quick Start

### 1. Initialize a Project

```bash
agentprobe init
```

This creates a sample test file and example trace to get you started.

### 2. Write Your First Test

Create `tests/agent.test.yaml`:

```yaml
name: My Agent Tests
tests:
  - name: Agent calls search tool
    trace: traces/search.json
    expect:
      tool_called: web_search
      output_contains: "result"
      max_steps: 10
```

### 3. Run Tests

```bash
agentprobe run tests/agent.test.yaml
```

## Core Concepts

### Traces

A **trace** is a recording of an agent's execution — every LLM call, tool invocation, and output. AgentProbe tests run against traces, making them deterministic and fast.

```json
{
  "agent": "my-agent",
  "model": "gpt-4",
  "steps": [
    { "type": "llm_call", "input": "What's the weather?", "output": "I'll search for that." },
    { "type": "tool_call", "tool": "web_search", "args": { "query": "weather" }, "result": "Sunny, 72°F" },
    { "type": "llm_call", "input": null, "output": "The weather is sunny and 72°F." }
  ],
  "final_output": "The weather is sunny and 72°F.",
  "total_tokens": 150,
  "cost_usd": 0.003
}
```

### Test Suites

Tests are defined in YAML files containing a `name` and a list of `tests`:

```yaml
name: Suite Name
tests:
  - name: Test case
    input: "user input"
    trace: path/to/trace.json
    expect:
      tool_called: some_tool
      output_contains: "expected text"
```

### Assertions

Assertions verify specific properties of agent behavior. See [assertions.md](assertions.md) for the full list.

### Adapters

If your traces aren't in AgentProbe's native format, adapters convert them automatically. See [adapters.md](adapters.md).

## Recording Traces

### From OpenAI SDK

```typescript
import { Recorder } from '@neuzhou/agentprobe';

const recorder = new Recorder();
recorder.patchOpenAI(openai); // Patches the OpenAI client
// ... run your agent ...
const trace = recorder.stop();
recorder.save('traces/my-trace.json');
```

### From Anthropic SDK

```typescript
recorder.patchAnthropic(anthropic);
```

### Streaming

```typescript
import { StreamingRecorder } from '@neuzhou/agentprobe/streaming';
// Records from streaming (SSE) responses
```

## Running Tests

### Basic

```bash
agentprobe run tests/agent.test.yaml
```

### Multiple Suites

```bash
agentprobe run tests/*.yaml
agentprobe run tests/ --recursive
```

### With Options

```bash
agentprobe run tests/ -f json -o results.json    # JSON output
agentprobe run tests/ -f junit -o results.xml     # JUnit for CI
agentprobe run tests/ --tag security              # Filter by tag
agentprobe run tests/ --coverage --tools search,fetch  # Tool coverage
agentprobe run tests/ --badge badge.svg           # Generate badge
```

## What's Next?

- [All Assertion Types](assertions.md)
- [Adapter Reference](adapters.md)
- [CLI Reference](cli-reference.md)
- [Security Testing](security-testing.md)
- [CI Integration](ci-integration.md)
- [Configuration](configuration.md)
