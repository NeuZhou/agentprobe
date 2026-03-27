---
title: "Your AI Agent Has No Tests — Here's How to Fix That in 5 Minutes"
published: true
tags: ai, testing, typescript, opensource
---

You test your UI. You test your API. You write integration tests, unit tests, E2E tests.

But your AI agent? It picks tools, handles failures, processes PII, makes autonomous decisions — and you're running it in production with **zero tests**.

That's wild. Let's fix it.

## The Problem Nobody Talks About

AI agents are not just LLMs with a nice wrapper. They:

- **Call tools** — and sometimes call the wrong one
- **Make decisions** — routing, retries, fallbacks
- **Handle errors** — or silently swallow them
- **Process sensitive data** — PII, credentials, financial info

Existing testing tools don't cover this. Promptfoo tests prompts. DeepEval tests outputs. But nothing tests **agent behavior** — the decisions your agent makes between receiving a request and returning a response.

What happens when your tool times out? When the LLM hallucinates a function name? When two agents in a pipeline disagree? You don't know, because you've never tested it.

## AgentProbe: Playwright for AI Agents

[AgentProbe](https://github.com/NeuZhou/agentprobe) brings the same test-driven discipline you use for web apps to AI agents. Define tests in YAML. Run them in CI. Get deterministic results.

Here's what a test case looks like:

```yaml
name: weather-tool-selection
description: Agent should pick the weather tool for forecast queries

steps:
  - send:
      message: "What's the weather in Tokyo tomorrow?"
    assert:
      - tool_called: get_weather
      - tool_args:
          location: "Tokyo"
      - response_contains: "forecast"
      - no_pii_leaked: true
```

That's it. No SDK to learn, no test framework to fight. Write YAML, run tests, ship with confidence.

## What Makes AgentProbe Different

**Chaos Testing** — Inject tool failures, slow responses, malformed outputs. See how your agent handles the real world, not just the happy path.

```yaml
chaos:
  - tool: get_weather
    failure: timeout
    after: 2 calls
```

**Contract Testing** — Verify that your agent's tool calls match the expected schema. Catch breaking changes before they hit production.

**Multi-Agent Testing** — Test pipelines where multiple agents collaborate. Assert on handoffs, message passing, and coordination failures.

**Record & Replay** — Record a live agent session, then replay it as a regression test. No mocking required.

## Battle-Tested

AgentProbe isn't a weekend project. The framework runs **2,907 passing tests** against itself. We test the testing framework — because we actually believe in testing.

## Get Started in 5 Minutes

```bash
npm install @neuzhou/agentprobe
```

Create a test file `agent.test.yaml`:

```yaml
name: basic-agent-test
agent:
  entrypoint: ./my-agent

tests:
  - name: tool-selection
    send: "Search for recent news about AI"
    assert:
      - tool_called: web_search
      - response_not_empty: true

  - name: error-handling
    send: "Search for news"
    chaos:
      - tool: web_search
        failure: error
    assert:
      - graceful_fallback: true
      - no_raw_error_in_response: true
```

Run it:

```bash
npx agentprobe run agent.test.yaml
```

Done. Your agent now has tests.

## Why This Matters

Every month, another story drops about an AI agent going rogue in production — leaking data, calling wrong APIs, running up bills on infinite retry loops. The fix isn't better prompts. It's **tests**.

You wouldn't deploy a web app without tests. Stop deploying agents without them.

---

⭐ [GitHub: NeuZhou/agentprobe](https://github.com/NeuZhou/agentprobe)

MIT Licensed. PRs welcome.
