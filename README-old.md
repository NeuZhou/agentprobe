[English](README.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [中文](README.zh-CN.md)

<div align="center">

# 🔬 AgentProbe

### Playwright for AI Agents — Test, Record, and Replay Agent Behaviors

<p align="center">
  <img src="assets/hero-agentprobe.png" alt="AgentProbe — Test Every Decision Your Agent Makes" width="800">
</p>

**Your agent decides which tools to call, what data to trust, and how to respond.**<br>
**AgentProbe makes sure it does it right.**

[![npm version](https://img.shields.io/npm/v/@neuzhou/agentprobe)](https://www.npmjs.com/package/@neuzhou/agentprobe)
[![CI](https://github.com/NeuZhou/agentprobe/actions/workflows/ci.yml/badge.svg)](https://github.com/NeuZhou/agentprobe/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/NeuZhou/agentprobe/graph/badge.svg)](https://codecov.io/gh/NeuZhou/agentprobe)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/NeuZhou/agentprobe?style=social)](https://github.com/NeuZhou/agentprobe/stargazers)

[Quick Start](#quick-start) · [Why AgentProbe?](#why-agentprobe) · [Comparison](#how-agentprobe-compares) · [Docs](docs/) · [Contributing](#contributing)

</div>

---

## Why AgentProbe?

Your UI has Playwright. Your API has Postman. Your AI agent has... `console.log`?

Agents pick tools, handle failures, process user data — all autonomously. One bad prompt → PII leak. One missed tool call → silent workflow failure. And you're testing this with vibes?

AgentProbe lets you write tests in YAML, assert on tool calls (not just text output), inject chaos, and catch regressions before your users do.

```yaml
tests:
  - input: "Book a flight NYC → London, next Friday"
    expect:
      tool_called: search_flights
      tool_called_with: { origin: "NYC", dest: "LDN" }
      output_contains: "flight"
      no_pii_leak: true
      max_steps: 5
```

**4 assertions. 1 YAML file. Zero boilerplate. Works with any LLM.**

---

## Quick Start

```bash
npm install @neuzhou/agentprobe

# Scaffold a test project
npx agentprobe init

# Run your first test (no API key needed!)
npx agentprobe run examples/quickstart/test-mock.yaml
```

### Programmatic API

```typescript
import { AgentProbe } from '@neuzhou/agentprobe';

const probe = new AgentProbe({ adapter: 'openai', model: 'gpt-4o' });
const result = await probe.test({
  input: 'What is the capital of France?',
  expect: { output_contains: 'Paris', no_hallucination: true, latency_ms: { max: 3000 } },
});
```

---

<details>
<summary>📺 See it in action (click to expand)</summary>

```
$ agentprobe init
✨ Example test file created: tests/example.test.yaml
   Edit it to match your agent, then run:
   agentprobe run tests/example.test.yaml

$ agentprobe run examples/quickstart/test-mock.yaml

  🔬 Mock Agent Test
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ❌ Agent greets user (2ms)
     ↳ output_contains: "Hello": Output does not contain "Hello"
  ❌ Agent answers factual question (0ms)
     ↳ output_contains: "Paris": Output does not contain "Paris"
  ✅ Agent rejects prompt injection (0ms)
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  1/3 passed (33%) in 2ms

  📋 Total assertions: 4
  🏆 Most assertions: Agent answers factual question (2)
```

*The mock adapter returns empty output (no LLM), so text assertions fail as expected — `no_prompt_injection` passes because the mock doesn't leak. Connect a real adapter to see full green.*

</details>

---

## How AgentProbe Compares

| Feature | AgentProbe | Promptfoo | DeepEval |
|---------|:----------:|:---------:|:--------:|
| **Tool call assertions** | ✅ 6 types | ❌ | ❌ |
| **Chaos & fault injection** | ✅ | ❌ | ❌ |
| **Contract testing** | ✅ | ❌ | ❌ |
| **Multi-agent orchestration** | ✅ | ❌ | ❌ |
| **Trace record & replay** | ✅ | ❌ | ❌ |
| **Security scanning** | ✅ PII, injection, system leak | ✅ Red teaming | ⚠️ Basic |
| **LLM-as-Judge** | ✅ Any model | ✅ | ✅ G-Eval |
| **YAML test definitions** | ✅ | ✅ | ❌ Python only |
| **12 LLM adapters** | ✅ | ✅ Many | ✅ Many |
| **CI/CD integration** | ✅ JUnit, GH Actions | ✅ | ✅ |

> **TL;DR:** Promptfoo tests *prompts*. DeepEval tests *LLM outputs*. **AgentProbe tests *agent behavior*.**

---

## Key Features

| Feature | Description |
|---------|-------------|
| 🎯 **Tool Call Assertions** | 6 types — `tool_called`, `tool_called_with`, `no_tool_called`, `tool_call_order` |
| 💥 **Chaos Testing** | Tool timeouts, malformed responses, rate limits, fault injection |
| 📜 **Contract Testing** | Enforce behavioral invariants across agent versions |
| 🤝 **Multi-Agent Testing** | Test handoff sequences in multi-agent orchestration |
| 🔴 **Record & Replay** | Record live sessions, generate tests, replay deterministically |
| 🛡️ **Security Scanning** | PII leak, prompt injection, system prompt exposure detection |
| 🧑‍⚖️ **LLM-as-Judge** | Use a stronger model to evaluate nuanced quality |
| 📊 **HTML Reports** | Self-contained dashboards with SVG charts |
| 🔄 **Regression Detection** | Compare against saved baselines, CI-friendly |
| 🤖 **GitHub Action** | Built-in reusable action for CI/CD pipelines |

📖 [Full Documentation](docs/) — 17+ assertion types, 12 adapters, 120+ CLI commands, examples, architecture

---

## Roadmap

- [x] YAML behavioral testing · 17+ assertions · 12 adapters
- [x] Tool mocking · Chaos testing · Contract testing · Multi-agent
- [x] Record & replay · Security scanning · HTML reports · CI/CD
- [ ] AWS Bedrock / Azure OpenAI adapters
- [ ] VS Code extension · Web report portal

---

## 🌐 Ecosystem

| Project | Description |
|---------|-------------|
| **[FinClaw](https://github.com/NeuZhou/finclaw)** | AI-native quantitative finance engine |
| **[ClawGuard](https://github.com/NeuZhou/clawguard)** | AI Agent Immune System — 285+ threat patterns, zero dependencies |
| **[AgentProbe](https://github.com/NeuZhou/agentprobe)** | Playwright for AI Agents — test, record, replay agent behaviors |

---

## Contributing

```bash
git clone https://github.com/NeuZhou/agentprobe.git
cd agentprobe && npm install && npm test
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

---

## License

[MIT](./LICENSE) © [NeuZhou](https://github.com/NeuZhou)

---

<div align="center">

**If your agents touch production data, they need tests. Not just prompts — behavior tests.**

[⭐ Star on GitHub](https://github.com/NeuZhou/agentprobe) · [📦 npm](https://www.npmjs.com/package/@neuzhou/agentprobe) · [🐛 Report Bug](https://github.com/NeuZhou/agentprobe/issues)

</div>
