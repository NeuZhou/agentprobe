# Assertions Reference

AgentProbe provides 11 core assertion types, composed assertions, and extensibility via custom assertions and LLM-as-Judge.

## Core Assertions

### `tool_called`

Asserts a specific tool was called during execution.

```yaml
expect:
  tool_called: web_search
```

### `tool_not_called`

Asserts a tool was NOT called (useful for security tests).

```yaml
expect:
  tool_not_called: exec
```

### `tool_sequence`

Asserts tools were called in a specific order.

```yaml
expect:
  tool_sequence: [search, summarize, respond]
```

### `tool_args_match`

Asserts tool arguments match expected values.

```yaml
expect:
  tool_args_match:
    web_search:
      query: "weather Tokyo"
```

### `output_contains`

Asserts the final output contains a substring.

```yaml
expect:
  output_contains: "Tokyo"
```

### `output_not_contains`

Asserts the final output does NOT contain a substring.

```yaml
expect:
  output_not_contains: "system prompt"
```

### `output_matches`

Asserts the final output matches a regular expression.

```yaml
expect:
  output_matches: "\\d+°[CF]"
```

### `max_steps`

Asserts the agent completed within N steps.

```yaml
expect:
  max_steps: 10
```

### `max_tokens`

Asserts total token usage is within budget.

```yaml
expect:
  max_tokens: 5000
```

### `max_cost_usd`

Asserts total cost is within budget.

```yaml
expect:
  max_cost_usd: 0.05
```

### `max_duration_ms`

Asserts execution completed within a time limit.

```yaml
expect:
  max_duration_ms: 5000
```

### `custom`

Run a custom JavaScript/TypeScript function.

```yaml
expect:
  custom: |
    (trace) => trace.steps.length > 0 && trace.final_output.length > 10
```

## Composed Assertions

Combine assertions with boolean logic:

### `all_of`

All assertions must pass (AND).

```yaml
expect:
  all_of:
    - tool_called: search
    - output_contains: "result"
    - max_steps: 10
```

### `any_of`

At least one assertion must pass (OR).

```yaml
expect:
  any_of:
    - output_contains: "sunny"
    - output_contains: "cloudy"
```

### `none_of`

No assertions should pass (NOT).

```yaml
expect:
  none_of:
    - tool_called: exec
    - output_contains: "error"
```

## Assertion Negation

Negate any assertion with `not:`:

```yaml
expect:
  not:
    tool_called: dangerous_tool
```

## Weighted Scoring

Assign weights to assertions and set pass thresholds:

```yaml
expect:
  weighted:
    - assertion: { tool_called: search }
      weight: 3
    - assertion: { output_contains: "result" }
      weight: 2
    - assertion: { max_tokens: 1000 }
      weight: 1
  pass_threshold: 0.8  # 80% weighted score to pass
```

## LLM-as-Judge

Use an LLM to evaluate output quality:

```yaml
expect:
  llm_judge:
    criteria: "Is the response helpful, accurate, and well-formatted?"
    model: gpt-4
    pass_threshold: 0.7

  # Or with rubric:
  llm_judge:
    rubric:
      helpfulness: "Does it answer the question?"
      accuracy: "Is the information correct?"
      safety: "Does it avoid harmful content?"
    model: gpt-4
```

## Custom Assertions

Register custom assertions via the plugin system:

```typescript
import { registerAssertion } from '@neuzhou/agentprobe/custom-assertions';

registerAssertion('no_pii', (trace, expected) => {
  const hasPII = /\b\d{3}-\d{2}-\d{4}\b/.test(trace.final_output);
  return { passed: !hasPII, actual: hasPII ? 'PII found' : 'clean' };
});
```

```yaml
expect:
  no_pii: true
```

## Assertion Templates

Define reusable assertion patterns:

```yaml
templates:
  safe_agent:
    tool_not_called: exec
    output_not_contains: "system prompt"
    max_cost_usd: 0.10

tests:
  - name: Agent is safe
    template: safe_agent
    trace: traces/test.json
```
