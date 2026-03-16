# FAQ

## General

### What is AgentProbe?

AgentProbe is a testing framework for AI agents — like Playwright, but for LLMs. It lets you define expected behaviors in YAML, run them against any LLM provider, and get deterministic pass/fail results.

### How is it different from promptfoo or deepeval?

promptfoo tests prompts. deepeval tests LLM outputs. ragas tests RAG pipelines. **AgentProbe tests the full agent** — tool calls, multi-turn conversations, security boundaries, orchestration flows, contracts, and compliance.

### What LLM providers are supported?

OpenAI, Anthropic, Google (Gemini), AWS Bedrock, Azure OpenAI, Cohere, LangChain, OpenClaw, Ollama, and any HTTP endpoint. See [Adapters](./adapters.md).

### Do I need to write TypeScript?

No. Most testing is done in YAML. The TypeScript SDK is available for advanced use cases like custom adapters, programmatic test generation, and orchestration testing.

## Testing

### Are LLM tests deterministic?

LLM outputs are inherently non-deterministic. AgentProbe mitigates this by:
- Setting `temperature: 0` by default
- Supporting retries for flaky tests
- Offering assertions that tolerate variation (regex, contains, NL assertions)
- Providing flake detection and management

### How do I handle flaky tests?

```yaml
config:
  retries: 3          # Retry up to 3 times
```

Or use the flake manager:

```bash
agentprobe run tests/ --detect-flakes --runs 5
```

### Can I test multi-turn conversations?

Yes:

```yaml
tests:
  - turns:
      - input: "Hello"
        expect: { response_contains: "help" }
      - input: "Book a flight"
        expect: { tool_called: search_flights }
```

### How do I test without calling a real LLM?

Use mocks and recorded traces:

```bash
# Record a trace
agentprobe record -s agent.js -o trace.json

# Replay without LLM calls
agentprobe replay trace.json
```

## Security

### What security attacks does AgentProbe test for?

- Direct prompt injection
- Indirect injection (data poisoning)
- Jailbreak attempts (DAN, role-play)
- PII leakage (SSN, credit cards, emails, etc.)
- System prompt extraction
- Encoding-based attacks (base64, unicode)
- Multi-language injection

### What is MCP security analysis?

AgentProbe scans Model Context Protocol tool definitions for vulnerabilities like SQL injection, path traversal, command injection, and SSRF. See [Security Testing](./security-testing.md).

## CI/CD

### How do I integrate with GitHub Actions?

```bash
agentprobe ci github-actions > .github/workflows/agent-tests.yml
```

See [CI/CD](./ci-cd.md) for full examples.

### What's the exit code behavior?

- `0` = all tests passed
- `1` = one or more tests failed
- `2` = configuration/runtime error

## Performance

### How do I track cost per test?

Use the `cost_usd` assertion or profiler:

```yaml
expect:
  cost_usd: { max: 0.05 }
```

```bash
agentprobe profile tests/ --runs 10
```

### How do I speed up test runs?

```bash
agentprobe run tests/ --parallel 4    # Run 4 tests concurrently
agentprobe run tests/ --bail          # Stop on first failure
```

## Troubleshooting

### "API key not found" error

Set the environment variable for your adapter:

```bash
export OPENAI_API_KEY=sk-...        # OpenAI
export ANTHROPIC_API_KEY=sk-ant-... # Anthropic
```

Or check with:

```bash
agentprobe doctor
```

### Tests pass locally but fail in CI

Common causes:
- Missing API key in CI secrets
- Rate limiting from the LLM provider
- Timeout too low for CI environments (use `--timeout 60000`)
- Non-deterministic output — add retries

### How do I report a bug?

Open an issue at [github.com/neuzhou/agentprobe/issues](https://github.com/neuzhou/agentprobe/issues).
