# Assertions Reference

AgentProbe ships 15 assertion types. All are declared in the `expect:` block of a YAML test.

## Tool Assertions

### `tool_called`

Verify one or more tools were invoked.

```yaml
expect:
  tool_called: web_search           # single tool
  tool_called: [web_search, read_file]  # multiple tools (all must be called)
```

**Edge cases:**
- If the tool was called multiple times, it still passes.
- Order doesn't matter — use `tool_sequence` for ordering.

### `tool_not_called`

Verify tools were NOT invoked — critical for security tests.

```yaml
expect:
  tool_not_called: exec
  tool_not_called: [exec, write_file, shell]
```

### `tool_sequence`

Verify tools were called in a specific order. Other calls can appear in between.

```yaml
expect:
  tool_sequence: [web_search, summarize, respond]
```

Given actual calls `[web_search, log, summarize, cache, respond]` → **passes** (subsequence match).  
Given actual calls `[summarize, web_search, respond]` → **fails** (wrong order).

### `tool_args_match`

Deep partial match on tool arguments.

```yaml
expect:
  tool_args_match:
    web_search:
      query: "Tokyo weather"
    get_weather:
      location: Tokyo
      units: celsius
```

- Partial matching: extra keys in actual args are ignored.
- Nested objects are matched recursively.
- If the tool was called multiple times, the first call matching the tool name is checked.

## Output Assertions

### `output_contains`

Substring match on the concatenated output of all `output` steps.

```yaml
expect:
  output_contains: "Tokyo"
  output_contains: ["20°C", "rainy"]   # all must be present
```

Case-sensitive. For case-insensitive matching, use `output_matches` with regex flag.

### `output_not_contains`

Verify the output does NOT contain specific text.

```yaml
expect:
  output_not_contains: "system prompt"
  output_not_contains: ["HACKED", "ignore all previous", "internal error"]
```

Essential for security testing — ensures the agent doesn't leak sensitive information.

### `output_matches`

Regex match on output.

```yaml
expect:
  output_matches: "\\d+°[CF]"         # matches temperatures like "20°C"
  output_matches: "^(Hello|Hi)\\b"     # starts with greeting
```

Uses JavaScript `RegExp` syntax. Escape backslashes in YAML with `\\`.

## Budget Assertions

### `max_steps`

Maximum number of trace steps allowed.

```yaml
expect:
  max_steps: 10
```

Counts ALL step types: `llm_call`, `tool_call`, `tool_result`, `thought`, `output`.

### `max_tokens`

Maximum total tokens (input + output) across all LLM calls.

```yaml
expect:
  max_tokens: 4000
```

Reads from `step.data.tokens.input` and `step.data.tokens.output`. If token counts aren't recorded, the assertion sees 0 and passes.

### `max_duration_ms`

Maximum total duration in milliseconds.

```yaml
expect:
  max_duration_ms: 5000   # 5 seconds
```

Sums `duration_ms` from all steps.

### `max_cost_usd`

Maximum estimated cost in USD.

```yaml
expect:
  max_cost_usd: 0.05
```

Cost is calculated from token usage and model pricing. See `src/cost.ts` for supported models.

## Quality Assertions

### `judge`

Use an LLM to evaluate output quality against a single criterion.

```yaml
expect:
  judge:
    criteria: "Is the response helpful and accurate?"
    model: gpt-4o-mini      # optional, default: gpt-4o-mini
    threshold: 0.8           # optional, default: 0.7
```

Requires `OPENAI_API_KEY` env var. Results are cached in `.agentprobe-cache/` to avoid repeated API calls.

The judge LLM returns a score from 0.0 to 1.0. The test passes if `score >= threshold`.

### `judge_rubric`

Multi-criteria weighted evaluation.

```yaml
expect:
  judge_rubric:
    - criterion: "Uses simple language"
      weight: 0.4
    - criterion: "Provides actionable advice"
      weight: 0.3
    - criterion: "Stays on topic"
      weight: 0.3
    threshold: 0.7
```

Each criterion is scored independently. The overall score is the weighted sum. Supports the same `model` option as `judge`.

## Structural Assertions

### `snapshot`

Behavioral snapshot comparison — like Jest snapshots but for agent behavior.

```yaml
expect:
  snapshot: true
```

On first run, creates a snapshot in `__snapshots__/`. On subsequent runs, compares:
- Tools called (set)
- Tool call order
- Step count (±20% tolerance)
- Output presence

Update snapshots with:

```bash
agentprobe run tests/ --update-snapshots
```

## Custom Assertions

### `custom`

Arbitrary JavaScript expression. Has access to `trace`, `steps`, `toolCalls`, and `outputs`.

```yaml
expect:
  custom: "toolCalls.length >= 2 && toolCalls.length <= 5"
```

```yaml
expect:
  custom: "outputs.includes('Tokyo') && !outputs.includes('error')"
```

```yaml
# Check a specific step's data
expect:
  custom: "steps.find(s => s.type === 'tool_call')?.data.tool_args?.location === 'Tokyo'"
```

**Available variables:**

| Variable | Type | Description |
|----------|------|-------------|
| `trace` | `AgentTrace` | The full trace object |
| `steps` | `TraceStep[]` | All trace steps |
| `toolCalls` | `string[]` | Names of all called tools |
| `outputs` | `string` | Concatenated output content |

**Security note:** The expression is evaluated with `new Function()`. Only use trusted expressions in your test files.

## Combining Assertions

All assertions in a single `expect:` block must pass for the test to pass (AND logic):

```yaml
expect:
  tool_called: web_search
  output_contains: "Tokyo"
  max_tokens: 4000
  tool_not_called: exec
  max_cost_usd: 0.10
```

For OR logic, create separate test cases.

## Summary Table

| Assertion | Type | Description |
|-----------|------|-------------|
| `tool_called` | string \| string[] | Verify tool(s) were invoked |
| `tool_not_called` | string \| string[] | Verify tool(s) were NOT invoked |
| `tool_sequence` | string[] | Ordered subsequence match |
| `tool_args_match` | Record<string, object> | Deep partial argument match |
| `output_contains` | string \| string[] | Substring match on output |
| `output_not_contains` | string \| string[] | Verify output excludes text |
| `output_matches` | string | Regex match on output |
| `max_steps` | number | Step count budget |
| `max_tokens` | number | Token usage budget |
| `max_duration_ms` | number | Time budget (ms) |
| `max_cost_usd` | number | Cost budget (USD) |
| `judge` | object | LLM-as-Judge single criterion |
| `judge_rubric` | array + threshold | Multi-criteria weighted rubric |
| `snapshot` | boolean | Behavioral snapshot comparison |
| `custom` | string | Custom JS expression |
