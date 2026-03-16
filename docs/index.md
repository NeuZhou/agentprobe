# AgentProbe Documentation

**Playwright for AI Agents** — Test, secure, and observe your AI agents with the same rigor you test your UI.

[![npm version](https://img.shields.io/npm/v/@neuzhou/agentprobe?style=flat-square&color=blue)](https://www.npmjs.com/package/@neuzhou/agentprobe)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-blue?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/npm/l/@neuzhou/agentprobe?style=flat-square)](https://github.com/neuzhou/agentprobe/blob/main/LICENSE)

---

## Why AgentProbe?

You test your UI. You test your API. You test your database queries. **But who tests your AI agent?**

Your agent decides which tools to call, what data to trust, and how to respond. One bad prompt leaks PII. One missed tool call breaks your workflow silently. One jailbreak and your agent says things your company would never approve.

AgentProbe fixes this: define expected behaviors in YAML, run them against any LLM, get deterministic pass/fail results.

## What Makes It Different

Most LLM testing tools focus on **prompt evaluation**. AgentProbe tests the **full agent lifecycle**:

- **Tool call verification** — Mock tools, inject faults, verify call sequences
- **Security scanning** — Prompt injection, jailbreak, PII leak detection
- **Chaos testing** — Timeouts, malformed responses, rate limits
- **Multi-agent orchestration** — End-to-end workflow testing
- **Contract testing** — Schema + behavioral contracts
- **Compliance** — Built-in GDPR, SOC2, HIPAA, PCI-DSS frameworks
- **MCP security analysis** — Scan Model Context Protocol tool definitions
- **Performance profiling** — Latency percentiles, cost tracking, bottleneck detection
- **16+ assertion types** — From simple `response_contains` to `llm_judge`

## Architecture

```
┌─────────────────────────── AgentProbe CLI ───────────────────────────┐
│                 (run, record, security, compliance, ...)             │
├─────────────────────────── Test Runner ──────────────────────────────┤
│         YAML Suites  │  TypeScript SDK  │  Natural Language          │
├─────────────────────────── Core Engine ──────────────────────────────┤
│  Evaluator │ Recorder │ Profiler │ Security │ Mocks │ Chaos │ ...   │
├─────────────────────────── Adapter Layer ────────────────────────────┤
│  OpenAI │ Anthropic │ Google │ Bedrock │ Azure │ Cohere │ ...       │
├─────────────────────────── Reporters ────────────────────────────────┤
│  Console │ JSON │ JUnit │ HTML │ OpenTelemetry                      │
└──────────────────────────────────────────────────────────────────────┘
```

## Quick Links

| Page | Description |
|---|---|
| [Getting Started](./getting-started.md) | Install, write first test, run it in 3 minutes |
| [Writing Tests](./writing-tests.md) | YAML test format, all assertion types, examples |
| [Tool Mocking](./tool-mocking.md) | Mock tools, fault injection, chaos testing |
| [Security Testing](./security-testing.md) | Prompt injection, PII detection, MCP analysis |
| [Contract Testing](./contract-testing.md) | Agent contracts, verification, CI integration |
| [Adapters](./adapters.md) | All 11 adapters: setup, config, examples |
| [CLI Reference](./cli-reference.md) | Full CLI command reference |
| [CI/CD](./ci-cd.md) | GitHub Actions, GitLab CI, Jenkins integration |
| [Compliance](./compliance.md) | GDPR, SOC2, HIPAA, PCI-DSS audit framework |
| [Advanced](./advanced.md) | Benchmarks, profiling, NL assertions, git integration |
| [FAQ](./faq.md) | Common questions and answers |

## License

[MIT](https://github.com/neuzhou/agentprobe/blob/main/LICENSE) © [Kang Zhou](https://github.com/neuzhou)
