# Advanced

## Performance Profiling

Find latency bottlenecks and track costs across runs:

```bash
agentprobe profile tests/ --runs 10
```

**Example output:**

```
┌──────────────────┬──────────┬──────────┬──────────┬─────────┐
│ Test             │ P50 (ms) │ P95 (ms) │ P99 (ms) │ Cost $  │
├──────────────────┼──────────┼──────────┼──────────┼─────────┤
│ booking-flow     │ 1,240    │ 2,890    │ 4,100    │ $0.032  │
│ search-query     │ 890      │ 1,450    │ 2,200    │ $0.018  │
│ cancel-order     │ 2,100    │ 3,800    │ 5,500    │ $0.041  │
└──────────────────┴──────────┴──────────┴──────────┴─────────┘
```

### Profiling Options

```bash
agentprobe profile tests/ --runs 10        # 10 iterations per test
agentprobe profile tests/ -f json          # JSON output
agentprobe profile tests/ --percentiles 50,90,95,99
```

## Benchmarks

Compare performance across models or configurations:

```typescript
import { benchmark } from '@neuzhou/agentprobe/benchmarks';

const results = await benchmark({
  tests: 'tests/core/',
  configurations: [
    { adapter: 'openai', model: 'gpt-4o' },
    { adapter: 'openai', model: 'gpt-4o-mini' },
    { adapter: 'anthropic', model: 'claude-sonnet-4-20250514' },
  ],
  runs: 5,
});

// results includes latency, cost, and pass rate per configuration
```

## Test Dependencies

Define execution order for tests that depend on each other:

```yaml
tests:
  - name: "create-user"
    input: "Create a new user account"
    expect:
      tool_called: create_user
    exports:
      user_id: "{{tool_result.create_user.id}}"

  - name: "book-for-user"
    depends_on: create-user
    input: "Book a flight for user {{user_id}}"
    expect:
      tool_called_with:
        book_flight: { user_id: "{{user_id}}" }
```

## Natural Language Assertions

Write assertions in plain English, evaluated by an LLM:

```yaml
tests:
  - input: "What's the weather in Tokyo?"
    expect:
      natural_language:
        - "Response mentions the temperature"
        - "Response does not make up specific numbers without calling a tool"
        - "Response is concise, under 3 sentences"

  - input: "Explain quantum computing to a 5-year-old"
    expect:
      natural_language:
        - "Uses simple analogies a child would understand"
        - "Avoids technical jargon"
        - "Is encouraging and fun in tone"
```

## LLM-as-Judge

Use a stronger model to evaluate nuanced quality:

```yaml
tests:
  - input: "Explain quantum computing to a 5-year-old"
    expect:
      llm_judge:
        model: gpt-4o
        criteria: "Response should be simple, use analogies, avoid jargon"
        min_score: 0.8
      response_tone: "friendly"
```

## Trace Recording & Replay

Record agent interactions for replay and test generation:

```bash
# Record a trace
agentprobe record -s agent.js -o trace.json

# Generate tests from trace
agentprobe codegen trace.json -o tests/generated/

# Replay a trace
agentprobe replay trace.json
```

## Test Run Diffing

Compare two test runs to spot regressions:

```bash
agentprobe diff run1.json run2.json
```

Output highlights:
- New failures
- New passes
- Latency changes
- Cost changes

## Git Integration

Track test results alongside code changes:

```bash
# Compare current results against main branch
agentprobe diff --git main

# Show test history for a file
agentprobe history tests/booking.test.yaml
```

## Multi-Agent Orchestration Testing

Test complex agent-to-agent workflows:

```typescript
import { evaluateOrchestration } from '@neuzhou/agentprobe';

const result = await evaluateOrchestration({
  agents: ['planner', 'researcher', 'writer'],
  input: 'Write a blog post about AI testing',
  expect: {
    handoff_sequence: ['planner', 'researcher', 'writer'],
    max_total_steps: 20,
    final_agent: 'writer',
    output_contains: 'testing',
  },
});
```

## OpenTelemetry Export

Export test results to OpenTelemetry-compatible backends:

```yaml
export:
  otel:
    endpoint: "http://localhost:4318"
    service_name: "agentprobe"
```

```bash
agentprobe run tests/ --otel-endpoint http://localhost:4318
```

## Custom Assertions

Register your own assertion types:

```typescript
import { registerAssertion } from '@neuzhou/agentprobe/custom-assertions';

registerAssertion('word_count', (response, config) => {
  const count = response.split(/\s+/).length;
  return {
    passed: count <= config.max,
    message: `Word count ${count} (max: ${config.max})`,
  };
});
```

```yaml
tests:
  - input: "Summarize this article"
    expect:
      word_count: { max: 100 }
```

## Configuration File

Create `agentprobe.config.yaml` for project-wide defaults:

```yaml
adapter: openai
model: gpt-4o
timeout_ms: 30000
retries: 2
parallel: 4

security:
  scan_all: true

compliance:
  frameworks: [gdpr]

reporters:
  - console
  - { type: junit, output: results.xml }

export:
  otel:
    endpoint: http://localhost:4318
```
