# Product Hunt Prep — AgentProbe

---

## Tagline

Playwright for AI Agents — behavioral testing in YAML

## Description

AgentProbe is a behavioral testing framework for AI agents. Write tests in YAML to assert on tool calls, decision sequences, token budgets, and security boundaries. Includes fault injection (chaos engineering for agents), 30+ built-in security attack patterns, and trace replay for deterministic testing. Runs in CI, outputs JUnit, catches regressions automatically.

## Key Features

1. **YAML-Based Behavioral Tests** — 14+ assertion types for tool calls, sequences, outputs, budgets, and security. No code required.

2. **Fault Injection** — Chaos engineering for agents. Simulate tool errors, timeouts, slow responses, and corrupted data to test resilience.

3. **Security Attack Suite** — 30+ built-in patterns covering prompt injection, data exfiltration, and privilege escalation. Generate a full suite with one command.

4. **Trace Replay & Diff** — Record agent traces, replay deterministically, compare versions. Works with OpenAI, Anthropic, LangChain, and OpenClaw formats.

5. **CI-Ready** — GitHub Actions template, JUnit output, coverage reports, regression baselines. Fits into any development workflow.

## First Comment Script

Hey everyone! 👋 I'm NeuZhou, and I built AgentProbe because I kept seeing the same problem: AI agents go to production with impressive demos but zero behavioral testing.

We have Playwright for web apps, Postman for APIs, but nothing for testing agent *decisions* — which tools they call, how they handle failures, whether they resist prompt injection.

AgentProbe fills that gap. A few things I'm proud of:

• **Fault injection** — Borrowed from chaos engineering. Simulate tool failures and watch if your agent recovers or spirals into a $200 retry loop.
• **Security testing in one command** — `agentprobe generate-security` creates 30+ attack tests instantly.
• **YAML everything** — No test code to write. If you can write config, you can write agent tests.

The framework is MIT licensed and I'm actively building based on community feedback. I'd love to hear: what agent behaviors would you want to test? What failure modes keep you up at night?

Try it: `npm install -g @neuzhou/agentprobe`

Thanks for checking it out! 🔬
