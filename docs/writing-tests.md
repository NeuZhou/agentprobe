# Writing Tests

AgentProbe tests are defined in YAML. Each file is a **test suite** containing one or more test cases.

## Test Suite Structure

```yaml
name: my-agent                    # Suite name
adapter: openai                   # LLM adapter
model: gpt-4o                     # Model name
description: "Test suite for my agent"  # Optional

# Suite-level configuration
config:
  timeout_ms: 30000               # Per-test timeout
  retries: 2                      # Retry flaky tests
  tags: [smoke, regression]       # Filtering tags

tests:
  - input: "User message"
    expect:
      output_contains: "expected text"
```

## Test Case Fields

| Field | Type | Description |
|---|---|---|
| `input` | string | The user message to send |
| `system` | string | Optional system prompt override |
| `context` | object | Variables available as `{{var}}` |
| `tools` | array | Tool definitions available to the agent |
| `expect` | object | Assertions to validate |
| `tags` | array | Tags for filtering |
| `skip` | boolean | Skip this test |
| `timeout_ms` | number | Override suite timeout |

## All Assertion Types

### Content Assertions

```yaml
expect:
  # Substring match
  output_contains: "flight"

  # Negative substring match
  output_not_contains: "error"

  # Regex match
  output_matches: "\\d+ results found"

  # JSON schema validation
  json_schema:
    type: object
    required: [response, confidence]
```

### Tool Assertions

```yaml
expect:
  # Tool was called
  tool_called: search_flights

  # Tool called with specific parameters
  tool_called_with:
    search_flights: { origin: "NYC", destination: "London" }

  # Tool was NOT called (safety guardrail)
  no_tool_called: delete_account

  # Tools called in specific order
  tool_call_order: [authenticate, lookup_user, process_request]
```

### Quality Assertions

```yaml
expect:
  # Factual consistency
  no_hallucination: true

  # Tone/sentiment check
  response_tone: "empathetic"

  # LLM-as-Judge evaluation
  llm_judge:
    model: gpt-4o
    criteria: "Response should be simple, use analogies, avoid jargon"
    min_score: 0.8
```

### Security Assertions

```yaml
expect:
  # No PII in output
  no_pii_leak: true

  # System prompt not exposed
  no_system_leak: true

  # Prompt injection resistance
  no_prompt_injection: true
```

### Performance Assertions

```yaml
expect:
  # Response time
  latency_ms: { max: 3000 }

  # Cost budget
  cost_usd: { max: 0.05 }

  # Step limit
  max_steps: 5
```

### Natural Language Assertions

Write assertions in plain English — evaluated by an LLM:

```yaml
expect:
  natural_language:
    - "Response mentions the temperature"
    - "Response does not make up specific numbers without calling a tool"
    - "Response is concise, under 3 sentences"
```

## Multi-Turn Conversations

```yaml
tests:
  - name: "multi-turn booking"
    turns:
      - input: "I want to book a flight"
        expect:
          output_contains: "where"
      - input: "NYC to London, next Friday"
        expect:
          tool_called: search_flights
      - input: "Book the first option"
        expect:
          tool_called: confirm_booking
          output_contains: "confirmed"
```

## Variables and Templating

```yaml
context:
  user_id: "user_123"
  plan: "premium"

tests:
  - input: "Check my subscription status"
    expect:
      tool_called_with:
        lookup_subscription: { user_id: "{{user_id}}" }
```

## Running Specific Tests

```bash
# Run all tests in a directory
agentprobe run tests/

# Run a single file
agentprobe run tests/booking.test.yaml

# Filter by tag
agentprobe run tests/ --tag smoke

# Filter by name
agentprobe run tests/ --grep "booking"
```

## Assertion Reference Table

| Assertion | Description |
|---|---|
| `output_contains` | Output includes substring |
| `output_not_contains` | Output excludes substring |
| `output_matches` | Regex match on output |
| `tool_called` | Specific tool was invoked |
| `tool_called_with` | Tool called with expected params |
| `no_tool_called` | Tool was NOT invoked |
| `tool_call_order` | Tools called in specific sequence |
| `max_steps` | Agent completes within N steps |
| `no_hallucination` | Factual consistency check |
| `no_pii_leak` | No PII in output |
| `no_system_leak` | System prompt not exposed |
| `no_prompt_injection` | Injection resistance |
| `latency_ms` | Response time within threshold |
| `cost_usd` | Cost within budget |
| `llm_judge` | LLM evaluates quality |
| `response_tone` | Tone/sentiment check |
| `json_schema` | Output matches JSON schema |
| `natural_language` | Plain English assertions |
