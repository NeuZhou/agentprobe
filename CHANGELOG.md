# Changelog

All notable changes to AgentProbe are documented here.

## [1.0.0] - 2026-03-21

### Changed
- README cleaned up for professional tone

### Fixed
- Example YAML files updated to current schema format
- Flaky timestamp test in snapshot parallel tests
- CostReport missing fields
- Unsafe JSON.parse in trace parser

## [0.1.0] - 2026-03-17

### Initial Release 🎉

First public release of AgentProbe — "Playwright for AI Agents".

#### Core Features
- **YAML test suites** — Define agent behavioral tests in simple YAML
- **CLI runner** (`agentprobe run`) — Execute tests with colored console output
- **11+ assertion types** — `response_contains`, `tool_called`, `tool_called_with`, `no_tool_called`, `tool_call_order`, `max_steps`, `no_hallucination`, `no_pii_leak`, `no_system_leak`, `latency_ms`, `cost_usd`, `llm_judge`, `response_tone`, `json_schema`, `natural_language`
- **Programmatic SDK** — TypeScript API via `AgentProbe` class

#### Adapters
- OpenAI, Anthropic, Google Gemini, LangChain, Ollama, OpenAI-compatible, Generic HTTP, OpenClaw

#### Testing Capabilities
- **Tool mocking & fault injection** — Mock external tools, inject timeouts/errors/corruption
- **Security scanning** — Prompt injection, jailbreak, PII leak detection, MCP tool analysis
- **Chaos testing** — Fault injection scenarios (timeout, malformed response, rate limit)
- **Multi-agent orchestration testing** — Test agent-to-agent handoffs
- **Contract testing** — Behavioral contracts with schema validation
- **LLM-as-Judge** — Use a stronger model to evaluate response quality
- **Trace recording & replay** — Capture and replay agent interactions
- **Performance profiling** — Latency percentiles and cost tracking

#### Reporters
- Console, JSON, JUnit XML, Markdown, HTML dashboard, GitHub Actions annotations

#### CLI Commands
- `run`, `record`, `security`, `compliance`, `contract`, `profile`, `codegen`, `diff`, `init`, `doctor`, `watch`, `portal`

#### Additional Modules
- OpenTelemetry export, config file support (`.agentprobe.yml`), test templates, A/B testing, conversation testing, golden test patterns, natural language test generation, PII anonymizer

---

## Roadmap

See [GitHub Issues](https://github.com/neuzhou/agentprobe/issues) for planned features and known issues.
