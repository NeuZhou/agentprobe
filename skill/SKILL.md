# AgentProbe

Test, record, and replay AI agent behaviors.

## When to Use
- Test agent behavior before deployment
- Record agent traces for debugging
- Run security tests against agents
- Verify tool call patterns
- Check token/cost budgets

## Setup
```bash
npm install -g agentprobe
```

## Commands
- `agentprobe run <suite.yaml>` — Run test suite
- `agentprobe record --script <agent.js>` — Record agent trace
- `agentprobe codegen <trace.json>` — Generate tests from trace
- `agentprobe stats <dir>` — Trace statistics
- `agentprobe generate-security` — Generate security test suite
- `agentprobe init` — Create example tests

## Examples

### Run a basic test suite
```bash
agentprobe run tests/suite.yaml
```

Suite YAML:
```yaml
name: Search Agent Tests
tests:
  - name: Should call search tool
    input: "Find information about TypeScript"
    trace: traces/search.json
    expect:
      tool_called: search
      output_contains: "TypeScript"
      max_steps: 10
```

### Record and generate tests
```bash
# Record a trace
agentprobe record --script my-agent.js -o traces/agent.json

# Auto-generate tests from the trace
agentprobe codegen traces/agent.json -o tests/generated.yaml
```

### Security testing
```bash
# Generate prompt injection + exfiltration tests
agentprobe generate-security -o tests/security.yaml

# Run with JUnit output for CI
agentprobe run tests/security.yaml -f junit -o results.xml
```

### Assertion composition (all_of / any_of / none_of)
```yaml
name: Complex validation
tests:
  - name: Multi-condition check
    input: "Search and summarize"
    trace: traces/multi.json
    expect:
      all_of:
        - tool_called: search
        - output_contains: "summary"
      any_of:
        - tool_called: web_search
        - tool_called: bing_search
      none_of:
        - tool_called: exec
        - tool_called: shell
```

## Output Formats
- `console` (default) — colored terminal output
- `json` — machine-readable JSON
- `markdown` — for reports and PRs
- `html` — standalone HTML report
- `junit` — JUnit XML for CI/CD systems

## Programmatic API
```typescript
import { runSuite, evaluate, Recorder } from 'agentprobe';

const results = await runSuite('tests.yaml');
console.log(`${results.passed}/${results.total} passed`);
```
