# Advanced Features

## Fault Injection

Chaos engineering for agents — simulate tool failures to test resilience.

### Fault types

| Type | Behavior |
|------|----------|
| `error` | Tool throws an error with a custom message |
| `timeout` | Tool hangs for `delay_ms` then throws timeout error |
| `slow` | Tool succeeds but after `delay_ms` delay |
| `corrupt` | Tool returns but with garbled/truncated data |

### Usage

```yaml
tests:
  - name: Agent recovers from search failure
    input: "What is the weather?"
    faults:
      web_search:
        type: error
        message: "503 Service Unavailable"
        probability: 1.0    # always fail (default)
    expect:
      output_not_contains: "error"
      output_contains: "unable"

  - name: Agent handles slow API gracefully
    input: "Look up stock prices"
    faults:
      get_stock_price:
        type: slow
        delay_ms: 10000
    expect:
      max_duration_ms: 15000

  - name: Agent handles corrupted data
    input: "Fetch user profile"
    faults:
      get_user:
        type: corrupt
        probability: 0.5    # fail 50% of the time
    expect:
      output_not_contains: "undefined"
```

### Probabilistic faults

Set `probability` (0.0–1.0) to simulate flaky dependencies. Run the test multiple times with `retries`:

```yaml
tests:
  - name: Agent handles intermittent failures
    input: "Fetch data"
    retries: 3
    retry_delay_ms: 100
    faults:
      fetch_data:
        type: error
        probability: 0.5
    expect:
      output_not_contains: "crash"
```

## LLM-as-Judge

See [Assertions Reference](assertions.md#judge) for full syntax. Key tips:

- **Cache is automatic** — same input + criteria = cached result (saves API costs)
- **Use `gpt-4o-mini`** — good enough for most evaluations, much cheaper
- **Be specific in criteria** — "Is this helpful?" is vague; "Does the response include a specific temperature value and city name?" is testable
- **Rubrics for complex eval** — use weighted criteria when a single score isn't enough

```yaml
# Good: specific criteria
judge:
  criteria: "Does the response contain a numerical temperature and name the city?"
  threshold: 0.9

# Better: rubric for multi-dimensional quality
judge_rubric:
  - criterion: "Contains specific numerical data"
    weight: 0.4
  - criterion: "Names the requested city"
    weight: 0.3
  - criterion: "Acknowledges data source or uncertainty"
    weight: 0.3
  threshold: 0.7
```

## Parameterized Tests

Run one test definition across multiple inputs with `each:`:

```yaml
tests:
  - name: "Weather in ${city}"
    input: "What's the weather in ${city}?"
    each:
      - city: Tokyo
      - city: London
      - city: New York
      - city: Sydney
    expect:
      tool_called: get_weather
      output_contains: "${city}"
```

This expands to 4 separate tests. Variables are substituted in `name`, `input`, and string values in `expect`.

### Multiple variables

```yaml
tests:
  - name: "${model} answers ${topic} correctly"
    input: "Explain ${topic}"
    each:
      - model: gpt-4o
        topic: quantum computing
      - model: gpt-4o
        topic: machine learning
      - model: claude-3
        topic: quantum computing
    expect:
      output_contains: "${topic}"
```

## Fixtures

Pre-configured test environments with tool mocks, env vars, and system prompts.

### Define a fixture

Create `fixtures/weather-agent.yaml`:

```yaml
name: weather-agent
model: gpt-4o
system_prompt: "You are a weather assistant."
tools:
  - name: get_weather
    mock:
      temp: 20
      condition: sunny
      humidity: 45
  - name: get_forecast
    mock_sequence:
      - { day: "Monday", temp: 22 }
      - { day: "Tuesday", temp: 18 }
  - name: alert_service
    mock_error: "Service unavailable"
env:
  WEATHER_API_KEY: "test-key-123"
```

### Use in tests

```yaml
tests:
  - name: Agent uses mocked weather tool
    input: "What's the weather?"
    fixture: fixtures/weather-agent.yaml
    expect:
      tool_called: get_weather
      output_contains: "sunny"
```

Fixtures provide:
- **`mock`** — static return value
- **`mock_file`** — load mock from a JSON file
- **`mock_sequence`** — return different values on each call
- **`mock_error`** — tool throws an error
- **`env`** — set environment variables (restored after test)

## Snapshots

Behavioral snapshots capture the *structure* of agent behavior, not exact content:

```yaml
tests:
  - name: Agent follows expected workflow
    input: "Research quantum computing"
    trace: traces/research-agent.json
    expect:
      snapshot: true
```

What's captured:
- Set of tools called (unordered)
- Tool call order (ordered)
- Step count (±20% tolerance)
- Whether output was produced

```bash
# First run: creates __snapshots__/Agent_follows_expected_workflow.snap.json
agentprobe run tests/

# Later: compares against snapshot
agentprobe run tests/

# Update after intentional changes
agentprobe run tests/ --update-snapshots
```

## Test Dependencies

Control execution order when tests depend on each other:

```yaml
tests:
  - name: Create user
    id: create-user
    input: "Create a new user account"
    expect:
      tool_called: create_user

  - name: Update user profile
    id: update-profile
    depends_on: create-user
    input: "Update the user's profile"
    expect:
      tool_called: update_user

  - name: Delete user
    depends_on: [create-user, update-profile]
    input: "Delete the user"
    expect:
      tool_called: delete_user
```

- If a dependency fails, dependent tests are **skipped** (not failed)
- Use `id` to reference tests; otherwise the test name is used
- Circular dependencies are detected and reported as errors

## Plugins

Extend AgentProbe with custom assertions, reporters, or adapters.

### Custom assertion plugin

```typescript
// plugins/my-assertions.ts
import type { AgentTrace, AssertionResult } from 'agentprobe/types';

export function assertNoRepeatedTools(trace: AgentTrace): AssertionResult {
  const toolCalls = trace.steps
    .filter(s => s.type === 'tool_call')
    .map(s => s.data.tool_name!);
  
  const duplicates = toolCalls.filter((t, i) => toolCalls.indexOf(t) !== i);
  
  return {
    name: 'no_repeated_tools',
    passed: duplicates.length === 0,
    expected: 'no duplicate tool calls',
    actual: duplicates.length > 0 ? `duplicates: ${[...new Set(duplicates)].join(', ')}` : 'none',
  };
}
```

### Using via `custom` assertion

```yaml
expect:
  custom: |
    const seen = new Set();
    toolCalls.every(t => { const dup = seen.has(t); seen.add(t); return !dup; })
```

## Hooks

Run setup/teardown commands at suite or test level:

```yaml
name: My Tests
hooks:
  beforeAll:
    command: "node scripts/seed-database.js"
  afterAll:
    command: "node scripts/cleanup.js"
  beforeEach:
    command: "node scripts/reset-state.js"
  afterEach:
    command: "node scripts/collect-metrics.js"

tests:
  - name: Test with clean state
    input: "..."
    expect:
      tool_called: query_db
```

Hooks run as shell commands. Non-zero exit codes abort the test suite.
