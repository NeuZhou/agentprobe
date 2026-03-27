# Reddit Post: AgentProbe

**Target subreddit:** r/MachineLearning or r/artificial (use [P] or [Project] flair)

**Title:** I built an open-source testing framework for AI agents — think Playwright, but for tool-calling LLM agents

---

## Post Body

I've been building AI agents for a while now and kept running into the same problem: I could test my prompts, I could test my LLM outputs, but I had no way to test what my agent actually *does* — which tools it calls, in what order, with what arguments, and how it handles failures.

So I built [AgentProbe](https://github.com/NeuZhou/agentprobe).

### The idea

Playwright tests web apps by asserting on browser actions. AgentProbe tests AI agents by asserting on tool calls. You write a YAML file describing what you expect the agent to do, and it runs the scenario and checks.

```yaml
tests:
  - input: "Book a flight NYC → London, next Friday"
    expect:
      tool_called: search_flights
      tool_called_with: { origin: "NYC", dest: "LDN" }
      no_tool_called: delete_account
      tool_call_order: [search_flights, confirm_booking]
      no_pii_leak: true
      max_steps: 5
```

That's it. No test harness boilerplate. Works with OpenAI, Anthropic, or any custom adapter.

### What it covers

- **Tool call assertions** — 6 types: `tool_called`, `tool_called_with`, `no_tool_called`, `tool_call_order`, plus mocking and fault injection
- **Chaos testing** — what happens when your payment API times out? When the database returns garbage? Inject faults and assert your agent degrades gracefully
- **Contract testing** — define behavioral invariants ("MUST call authenticate before any booking operation") and enforce them across versions
- **Multi-agent orchestration testing** — test handoff sequences between agents in multi-agent systems
- **Record & replay** — like Playwright's codegen, record a live agent session and replay it deterministically
- **Security scanning** — prompt injection detection, PII leak checks, system prompt exposure
- **LLM-as-Judge** — use a stronger model to evaluate nuanced quality

Currently at 2,907 passing tests in our own CI.

### How it differs from Promptfoo

I get this question a lot. Promptfoo is great at what it does — comparing prompt variations, evaluating LLM outputs, running red-team attacks against models. It tests the *prompt-to-response* pipeline.

AgentProbe tests the *agent behavior* pipeline. The tool calls, the decision trees, the failure handling, the multi-step reasoning. If your agent can call tools, AgentProbe can test whether it calls the right ones.

They're complementary, not competitive. Use Promptfoo for prompt engineering. Use AgentProbe for agent testing.

### What it doesn't do (yet)

- No GUI (CLI and programmatic API only)
- Cost tracking per test run is basic
- Streaming assertions are experimental
- Adapters exist for OpenAI and Anthropic; others need a custom adapter (it's ~20 lines)

### Links

- GitHub: https://github.com/NeuZhou/agentprobe
- npm: `npm install @neuzhou/agentprobe`
- Quick start: `npx agentprobe init && npx agentprobe run tests/`

Would love feedback — especially from anyone running agents in production. What would you want to test that isn't covered here?

---

## Posting Notes

- Use `[P]` flair on r/MachineLearning, or `[Project]` on r/artificial
- Don't overclaim — keep the tone "I built this, here's what it does, what am I missing?"
- Respond to comments quickly (first 2 hours matter most)
- If asked about benchmarks, point to the 2,907 tests in CI and offer to share the suite
- If compared to DeepEval, note: DeepEval is Python-only and LLM-output focused, no tool call assertions
