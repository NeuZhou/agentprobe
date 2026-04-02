[English](README.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [中文](README.zh-CN.md)

<div align="center">

# 🔬 AgentProbe

### Playwright for AI Agents

<p align="center">
  <img src="assets/hero-agentprobe.png" alt="AgentProbe — Test Every Decision Your Agent Makes" width="720">
</p>

Test tool calls, not just text output. YAML-based. Works with any LLM.

<p>
  <a href="https://www.npmjs.com/package/@neuzhou/agentprobe"><img src="https://img.shields.io/npm/v/@neuzhou/agentprobe" alt="npm"></a>
  <a href="https://github.com/NeuZhou/agentprobe/actions/workflows/ci.yml"><img src="https://github.com/NeuZhou/agentprobe/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://codecov.io/gh/NeuZhou/agentprobe"><img src="https://codecov.io/gh/NeuZhou/agentprobe/graph/badge.svg" alt="codecov"></a>
  <img src="https://img.shields.io/badge/TypeScript-5.3+-blue?logo=typescript&logoColor=white" alt="TypeScript">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License"></a>
  <a href="https://github.com/NeuZhou/agentprobe/stargazers"><img src="https://img.shields.io/github/stars/NeuZhou/agentprobe?style=social" alt="Stars"></a>
</p>

<p>
  <a href="#-quick-start">Quick Start</a> ·
  <a href="#why-agentprobe">Why?</a> ·
  <a href="#how-agentprobe-compares">Comparison</a> ·
  <a href="docs/">Docs</a> ·
  <a href="https://discord.gg/kAQD7Cj8">Discord</a>
</p>

</div>

---

## Why AgentProbe?

LLM test tools validate text output. But agents don't just generate text — they pick tools, handle failures, and process user data autonomously. One bad tool call → PII leak. One missed step → silent workflow failure.

AgentProbe tests **what agents do**, not just what they say.

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

4 assertions. 1 YAML file. Zero boilerplate.

---

## ⚡ Quick Start

```bash
npm install @neuzhou/agentprobe
npx agentprobe init                                    # Scaffold test project
npx agentprobe run examples/quickstart/test-mock.yaml  # Run first test
```

No API key needed for the mock adapter.

### Programmatic API

```typescript
import { AgentProbe } from '@neuzhou/agentprobe';

const probe = new AgentProbe({ adapter: 'openai', model: 'gpt-4o' });
const result = await probe.test({
  input: 'What is the capital of France?',
  expect: {
    output_contains: 'Paris',
    no_hallucination: true,
    latency_ms: { max: 3000 },
  },
});
```

---

## How AgentProbe Compares

| | AgentProbe | Promptfoo | DeepEval |
|---|:---:|:---:|:---:|
| **Tool call assertions** | ✅ 6 types | ❌ | ❌ |
| **Chaos & fault injection** | ✅ | ❌ | ❌ |
| **Contract testing** | ✅ | ❌ | ❌ |
| **Multi-agent orchestration** | ✅ | ❌ | ❌ |
| **Record & replay** | ✅ | ❌ | ❌ |
| **Security scanning** | ✅ PII, injection, system leak | ✅ Red teaming | ⚠️ Basic |
| **LLM-as-Judge** | ✅ Any model | ✅ | ✅ |
| **YAML test definitions** | ✅ | ✅ | ❌ Python only |
| **CI/CD (JUnit, GH Actions)** | ✅ | ✅ | ✅ |

Promptfoo tests *prompts*. DeepEval tests *LLM outputs*. **AgentProbe tests *agent behavior*.**

---

## Features

| | |
|---|---|
| 🎯 **Tool Call Assertions** | `tool_called`, `tool_called_with`, `no_tool_called`, `tool_call_order` + 2 more |
| 💥 **Chaos Testing** | Inject tool timeouts, malformed responses, rate limits |
| 📜 **Contract Testing** | Enforce behavioral invariants across agent versions |
| 🤝 **Multi-Agent Testing** | Test handoff sequences in orchestrated pipelines |
| 🔴 **Record & Replay** | Record live sessions → generate tests → replay deterministically |
| 🛡️ **Security Scanning** | PII leak, prompt injection, system prompt exposure |
| 🧑‍⚖️ **LLM-as-Judge** | Use a stronger model to evaluate nuanced quality |
| 📊 **HTML Reports** | Self-contained dashboards with SVG charts |
| 🔄 **Regression Detection** | Compare against saved baselines |
| 🤖 **12 Adapters** | OpenAI, Anthropic, Google, Ollama, and 8 more |

<!-- architecture diagram -->

📖 [Full Docs](docs/) — 17+ assertion types, 12 adapters, 120+ CLI commands

---

<details>
<summary>📺 See it in action</summary>

```
$ agentprobe run tests/booking.yaml

  🔬 Agent Booking Test
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✅ Agent calls search_flights tool (12ms)
  ✅ Tool called with correct parameters (8ms)
  ✅ No PII leaked in response (3ms)
  ✅ Agent handles booking confirmation (15ms)
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  4/4 passed (100%) in 38ms
```

*4 assertions, 1 YAML file, zero boilerplate.*

</details>

---

## 🚀 GitHub Action

```yaml
# .github/workflows/agent-tests.yml
name: Agent Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: NeuZhou/agentprobe@master
        with:
          test_dir: './tests'
```

---

## Roadmap

- [x] YAML behavioral testing · 17+ assertions · 12 adapters
- [x] Tool mocking · Chaos testing · Contract testing
- [x] Multi-agent · Record & replay · Security scanning
- [x] HTML reports · JUnit output · GitHub Actions
- [ ] AWS Bedrock / Azure OpenAI adapters
- [ ] VS Code extension with test explorer
- [ ] Web dashboard for test results
- [ ] A/B testing for agent configurations
- [ ] Automated regression detection in CI
- [ ] Plugin marketplace for custom assertions
- [ ] OpenTelemetry trace integration

---

## 🌐 Also Check Out

| Project | What it does |
|---------|-------------|
| **[FinClaw](https://github.com/NeuZhou/finclaw)** | Self-evolving trading engine — 484 factors, genetic algorithm, walk-forward validated |
| **[ClawGuard](https://github.com/NeuZhou/clawguard)** | AI Agent Immune System — 480+ threat patterns, zero dependencies |

---

## Contributing

We welcome contributions! Here's how to get started:

1. **Pick an issue** — look for [`good first issue`](https://github.com/NeuZhou/agentprobe/labels/good%20first%20issue) labels
2. **Fork & clone**
   ```bash
   git clone https://github.com/NeuZhou/agentprobe.git
   cd agentprobe && npm install && npm test
   ```
3. **Submit a PR** — we review within 48 hours

[CONTRIBUTING.md](./CONTRIBUTING.md) · [Discord](https://discord.gg/kAQD7Cj8) · [Report Bug](https://github.com/NeuZhou/agentprobe/issues) · [Request Feature](https://github.com/NeuZhou/agentprobe/issues)

---

## License

[MIT](./LICENSE) © [NeuZhou](https://github.com/NeuZhou)

---

## Star History

<a href="https://www.star-history.com/#NeuZhou/agentprobe&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=NeuZhou/agentprobe&type=Date&theme=dark" />
    <img alt="Star History" src="https://api.star-history.com/svg?repos=NeuZhou/agentprobe&type=Date" />
  </picture>
</a>
