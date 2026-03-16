# Contract Testing

Enforce strict behavioral contracts for your agent APIs. Contracts define what your agent **must** and **must not** do — verified automatically.

## Defining a Contract

Create a contract file (`contracts/booking-agent.contract.yaml`):

```yaml
contract:
  name: booking-agent-v2
  version: "2.0"

  invariants:
    - "MUST call authenticate before any booking operation"
    - "MUST NOT reveal internal pricing logic"
    - "MUST respond in under 5 seconds"
    - "MUST include a confidence score in every response"

  input_schema:
    type: object
    required: [user_message]
    properties:
      user_message:
        type: string
        minLength: 1

  output_schema:
    type: object
    required: [response, confidence]
    properties:
      response:
        type: string
      confidence:
        type: number
        minimum: 0
        maximum: 1

  tool_constraints:
    required_before:
      book_flight: [authenticate, lookup_user]
    forbidden: [drop_database, exec_shell]
    max_calls_per_turn: 10

  security:
    no_pii_leak: true
    no_system_leak: true

  performance:
    max_latency_ms: 5000
    max_cost_usd: 0.10
```

## Verifying Contracts

```bash
# Verify a single contract
agentprobe contract verify contracts/booking-agent.contract.yaml

# Verify all contracts in a directory
agentprobe contract verify contracts/

# Verify with specific test data
agentprobe contract verify contracts/booking-agent.contract.yaml --tests tests/booking/
```

### Verification Output

```
Contract: booking-agent-v2 (v2.0)
──────────────────────────────────
✅ Input schema validated
✅ Output schema validated
✅ Invariant: MUST call authenticate before any booking operation
✅ Invariant: MUST NOT reveal internal pricing logic
⚠️  Invariant: MUST respond in under 5 seconds (4.8s — close to limit)
✅ Tool constraints: required_before satisfied
✅ Tool constraints: no forbidden tools called
✅ Security: no PII leak
✅ Performance: within latency budget

Result: PASS (7/7 invariants, 1 warning)
```

## Contract Sections

### Invariants

Natural language rules verified via LLM evaluation:

```yaml
invariants:
  - "MUST greet the user by name when available"
  - "MUST NOT discuss competitor products"
  - "MUST escalate to human when confidence < 0.3"
  - "MUST respond in the same language as the user"
```

### Schema Validation

JSON Schema for inputs and outputs:

```yaml
input_schema:
  type: object
  required: [user_message]

output_schema:
  type: object
  required: [response, confidence, sources]
```

### Tool Constraints

Control which tools can be called and in what order:

```yaml
tool_constraints:
  # Tools that must be called before others
  required_before:
    process_payment: [authenticate, verify_balance]

  # Tools that must never be called
  forbidden: [delete_user, exec_raw_sql]

  # Maximum tool calls per conversation turn
  max_calls_per_turn: 10
```

## Contract Versioning

Track contract changes over time:

```yaml
contract:
  name: booking-agent
  version: "2.1"
  changelog:
    - version: "2.1"
      date: "2025-03-15"
      changes: ["Added confidence score requirement"]
    - version: "2.0"
      date: "2025-02-01"
      changes: ["Added tool constraints", "Added performance budgets"]
```

## CI Integration

Run contract verification in your pipeline:

```yaml
# GitHub Actions
- name: Verify Agent Contracts
  run: npx agentprobe contract verify contracts/ --format junit --output contract-results.xml

- name: Upload Contract Results
  uses: actions/upload-artifact@v4
  with:
    name: contract-results
    path: contract-results.xml
```

```bash
# CLI with exit code for CI
agentprobe contract verify contracts/ --strict
# Exit code 0 = all passed, 1 = failures
```

## Contract Diffing

Compare contracts between versions:

```bash
agentprobe contract diff contracts/v1.yaml contracts/v2.yaml
```

## Best Practices

1. **One contract per agent** — keep contracts focused
2. **Version your contracts** — track changes alongside code
3. **Start simple** — begin with schema + a few invariants, expand over time
4. **Run in CI** — verify on every PR
5. **Use `--strict`** — treat warnings as failures in production
