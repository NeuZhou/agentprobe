# Configuration

AgentProbe supports project-level configuration via config files, environment variables, and CLI profiles.

## Config File

Create `.agentproberc.yml` in your project root:

```yaml
# .agentproberc.yml
adapter: openai
parallel: 4
timeout: 30000
reporter: console
output_dir: results/
env_file: .env

# Plugins
plugins:
  - agentprobe-plugin-slack
  - ./my-custom-plugin.js

# Webhook notifications
webhooks:
  - url: https://hooks.slack.com/services/XXX
    events: [failure, regression]
  - url: https://discord.com/api/webhooks/XXX
    events: [failure]

# Profiles
profiles:
  ci:
    reporter: junit
    output_dir: test-results/
    parallel: 8
    timeout: 60000
  dev:
    reporter: console
    parallel: 1
```

Or use `agentprobe.config.ts` for TypeScript:

```typescript
export default {
  adapter: 'openai',
  parallel: 4,
  timeout: 30000,
  reporter: 'console',
};
```

## Config Options

| Option | Type | Default | Description |
|---|---|---|---|
| `adapter` | string | auto | Default trace adapter |
| `parallel` | number | 1 | Parallel test execution |
| `timeout` | number | 30000 | Default timeout (ms) |
| `reporter` | string | console | Output format |
| `output_dir` | string | — | Directory for results |
| `env_file` | string | — | Path to `.env` file |
| `plugins` | string[] | [] | Plugins to load |
| `webhooks` | object[] | [] | Webhook notifications |
| `profiles` | object | {} | Named config profiles |

## Profiles

Switch configurations with `--profile`:

```bash
agentprobe run tests/ --profile ci
```

## Environment Variables

### Per-Suite

```yaml
name: My Tests
env:
  API_KEY: test-key
  MODEL: gpt-4
tests: [...]
```

### Per-Test

```yaml
tests:
  - name: Test with env
    env:
      FEATURE_FLAG: "true"
    trace: traces/test.json
    expect:
      tool_called: search
```

### From File

```bash
agentprobe run tests.yaml --env-file .env.test
```

## Plugin System

### Installing Plugins

```bash
agentprobe plugin install <name>
```

### Creating a Plugin

Plugins export assertions, adapters, or reporters:

```javascript
// my-plugin.js
module.exports = {
  assertions: {
    no_pii: (trace, expected) => ({
      passed: !/\b\d{3}-\d{2}-\d{4}\b/.test(trace.final_output),
      actual: 'checked',
    }),
  },
};
```

Register in config:

```yaml
plugins:
  - ./my-plugin.js
```

## Compliance Policies

Define compliance rules in a policy file:

```yaml
# compliance.yml
rules:
  - name: No PII in output
    check: no_pii
  - name: Cost under $0.10
    check: max_cost
    threshold: 0.10
  - name: Only approved tools
    check: tool_allowlist
    tools: [search, summarize, respond]
```

```bash
agentprobe compliance traces/ --policy compliance.yml
```
