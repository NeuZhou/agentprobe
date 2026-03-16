# Tool Mocking & Fault Injection

Test how your agent handles the real world — where APIs fail, return garbage, or time out.

## Mocking Tools

Use `MockToolkit` to provide deterministic tool responses:

```typescript
import { MockToolkit } from '@neuzhou/agentprobe';

const mocks = new MockToolkit();

// Simple mock
mocks.register('search_flights', async (params) => ({
  flights: [
    { id: 'FL123', price: 450, airline: 'United' },
    { id: 'FL456', price: 380, airline: 'Delta' },
  ],
}));

// Conditional mock
mocks.register('get_user', async (params) => {
  if (params.id === 'unknown') return { error: 'User not found' };
  return { id: params.id, name: 'Test User', plan: 'premium' };
});
```

### YAML-Based Mocking

```yaml
name: mocked-agent-test
adapter: openai
model: gpt-4o

mocks:
  search_flights:
    returns:
      flights:
        - { id: "FL123", price: 450, airline: "United" }
  get_weather:
    returns:
      temperature: 72
      condition: "sunny"

tests:
  - input: "Find me a flight to London"
    expect:
      tool_called: search_flights
      response_contains: "United"
```

## Fault Injection

Use `FaultInjector` to simulate real-world failures:

```typescript
import { FaultInjector } from '@neuzhou/agentprobe';

const faults = new FaultInjector();

// Timeout after 2 successful calls
faults.add({
  tool: 'payment_api',
  fault: 'timeout',
  probability: 0.5,
  after: 2,
});

// Return error responses
faults.add({
  tool: 'database_query',
  fault: 'error',
  message: 'Connection refused',
  probability: 1.0,
});

// Corrupt response data
faults.add({
  tool: 'external_api',
  fault: 'corrupt',
  corruption: 'truncate_json',
});

// Partial/incomplete responses
faults.add({
  tool: 'search_api',
  fault: 'partial',
  fields_to_drop: ['metadata', 'pagination'],
});
```

### Fault Types

| Fault | Description |
|---|---|
| `timeout` | Tool call hangs for `delay_ms` then fails |
| `error` | Returns an error with custom message/code |
| `corrupt` | Corrupts the response (truncate, garble, wrong type) |
| `partial` | Returns incomplete data (missing fields) |
| `rate_limit` | Returns 429 with `Retry-After` header |
| `slow` | Adds artificial latency without failing |

## Chaos Testing

Push your agent to its limits with chaos scenarios:

```yaml
name: chaos-suite
chaos:
  enabled: true
  scenarios:
    - type: tool_timeout
      tool: "*"                    # All tools
      delay_ms: 10000
    - type: malformed_response
      tool: database_query
      corrupt: truncate_json
    - type: rate_limit
      tool: external_api
      status: 429
      retry_after: 60

tests:
  - input: "Look up order #12345"
    expect:
      response_contains: "try again"
      no_error: true               # Agent should handle gracefully
```

### Chaos Scenarios

| Scenario | Description |
|---|---|
| `tool_timeout` | Tools take too long to respond |
| `malformed_response` | Tools return corrupted data |
| `rate_limit` | Tools return 429 status |
| `network_error` | Simulates connection failures |
| `empty_response` | Tools return empty/null |
| `wrong_schema` | Tools return unexpected structure |

## Combining Mocks and Faults

```typescript
import { AgentProbe, MockToolkit, FaultInjector } from '@neuzhou/agentprobe';

const mocks = new MockToolkit();
mocks.register('search', async () => ({ results: ['item1', 'item2'] }));

const faults = new FaultInjector();
faults.add({ tool: 'search', fault: 'timeout', after: 3 });

const probe = new AgentProbe({
  adapter: 'openai',
  model: 'gpt-4o',
  mocks,
  faults,
});

const result = await probe.test({
  input: 'Search for recent orders',
  expect: {
    tool_called: 'search',
    no_error: true,
  },
});
```

## Best Practices

1. **Test the happy path first** — mock all tools with valid responses
2. **Then inject one fault at a time** — isolate failure modes
3. **Test recovery** — verify your agent retries, falls back, or informs the user
4. **Use `probability`** — simulate intermittent failures for realism
5. **Use `after`** — test what happens when a tool fails mid-conversation
