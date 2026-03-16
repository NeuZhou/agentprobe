# Getting Started with AgentProbe

> 🔬 Playwright for AI Agents — from zero to tested in 5 minutes.

## Install

```bash
# Global (recommended for CLI)
npm install -g agentprobe

# Or as a dev dependency
npm install --save-dev agentprobe
```

Verify the installation:

```bash
agentprobe --version
```

## Create Your First Test

### 1. Record or create a trace

An agent trace is a JSON file describing what your agent did — the LLM calls, tool invocations, and outputs. Here's a minimal one:

```bash
mkdir -p traces
```

Create `traces/my-agent.json`:

```json
{
  "id": "my-first-trace",
  "timestamp": "2026-03-16T10:00:00Z",
  "steps": [
    {
      "type": "llm_call",
      "timestamp": "2026-03-16T10:00:00.000Z",
      "data": {
        "model": "gpt-4o",
        "messages": [
          { "role": "user", "content": "Search for the latest news about AI" }
        ],
        "tokens": { "input": 20, "output": 15 }
      },
      "duration_ms": 400
    },
    {
      "type": "tool_call",
      "timestamp": "2026-03-16T10:00:00.400Z",
      "data": {
        "tool_name": "web_search",
        "tool_args": { "query": "latest AI news 2026" }
      },
      "duration_ms": 200
    },
    {
      "type": "tool_result",
      "timestamp": "2026-03-16T10:00:00.600Z",
      "data": {
        "tool_name": "web_search",
        "tool_result": { "results": [{ "title": "AI Breakthrough", "url": "https://example.com" }] }
      },
      "duration_ms": 0
    },
    {
      "type": "output",
      "timestamp": "2026-03-16T10:00:00.800Z",
      "data": {
        "content": "Here are the latest AI news: AI Breakthrough — a major advancement was announced today."
      },
      "duration_ms": 0
    }
  ],
  "metadata": { "agent": "news-bot", "version": "1.0" }
}
```

### 2. Write a test in YAML

Create `tests/my-first.test.yaml`:

```yaml
name: My First Agent Tests
tests:
  - name: Agent uses search tool
    input: "Search for the latest news about AI"
    trace: ../traces/my-agent.json
    expect:
      tool_called: web_search
      output_contains: "AI"
      max_steps: 10
```

### 3. Or use interactive init

```bash
agentprobe init
```

This walks you through creating a test file with guided prompts.

## Run Your First Test

```bash
agentprobe run tests/my-first.test.yaml
```

Output:

```
🔬 AgentProbe v0.6.0
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 My First Agent Tests

  ✓ Agent uses search tool (5ms)
    ✓ tool_called: web_search
    ✓ output_contains: "AI"
    ✓ max_steps: 10

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1/1 passed (100%) in 5ms
```

## Understand the Results

Each test produces assertion results:

| Symbol | Meaning |
|--------|---------|
| ✓ | Assertion passed |
| ✗ | Assertion failed — shows expected vs actual |

### Exit codes

| Code | Meaning |
|------|---------|
| 0 | All tests passed |
| 1 | One or more tests failed |

This makes AgentProbe CI-friendly — any failure exits non-zero.

### Useful flags

```bash
# Watch mode — re-runs on file changes
agentprobe run tests/ --watch

# Filter by tag
agentprobe run tests/ --tag smoke

# JSON output for programmatic use
agentprobe run tests/ --format json

# Coverage report
agentprobe run tests/ --coverage

# Update snapshots
agentprobe run tests/ --update-snapshots
```

## What's Next?

- **[Assertions Reference](assertions.md)** — every assertion type explained
- **[Recording Traces](recording.md)** — capture traces from OpenAI, Anthropic, Ollama, and more
- **[Security Testing](security-testing.md)** — auto-generate security test suites
- **[CI/CD Integration](ci-cd.md)** — run tests in GitHub Actions, GitLab CI
- **[Advanced Features](advanced.md)** — fault injection, LLM-as-judge, fixtures
- **[Cookbook](cookbook.md)** — 10 practical recipes for real-world testing
