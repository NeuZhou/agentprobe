# Reddit Posts — AgentProbe

---

## r/artificial — Safety Angle

**Title:** We're deploying AI agents to production with zero behavioral testing. I built a framework to fix that.

**Body:**

AI agents make autonomous decisions — picking tools, passing data, deciding when to stop. One wrong decision can leak user data, burn hundreds in API costs, or execute unintended actions.

Yet there's no standard way to test agent *behavior*. Eval benchmarks test model quality, not system safety. Nobody tests: "What happens when a tool times out?" or "Does the agent resist prompt injection?"

I built **AgentProbe** — a behavioral testing framework (think Playwright for agents) with:

- **Fault injection** — Simulate tool failures, timeouts, corrupted responses. Chaos engineering for agents.
- **30+ security attack patterns** — Prompt injection, data exfiltration, privilege escalation tests generated with one command.
- **Behavioral assertions** — Test tool sequences, budget limits, and output boundaries, not just "did it get the right answer."

All in YAML. Runs in CI. MIT licensed.

GitHub: https://github.com/NeuZhou/agentprobe

Curious what safety concerns keep you up at night when it comes to deployed agents.

---

## r/MachineLearning — Evaluation Methodology

**Title:** [P] AgentProbe: Behavioral testing framework for AI agents — beyond accuracy evals

**Body:**

Most agent evaluation focuses on output accuracy: run a benchmark, check scores. This misses an entire class of bugs — behavioral ones.

**AgentProbe** shifts evaluation from "what did the agent say" to "what did the agent *do*":

- **Trace-based testing** — Record agent execution traces, write assertions against tool calls, sequences, and resource usage
- **14+ assertion types** — tool_called, tool_sequence, max_tokens, max_cost, output_regex, LLM-as-Judge, snapshot comparison
- **Deterministic replay** — Test traces offline without LLM calls (fast, cheap, reproducible)
- **Fault injection** — Systematic resilience testing: error/timeout/slow/corrupt modes on individual tools
- **Parameterized tests** — One test template × N inputs, like property-based testing for agents

The key insight: separate model evaluation (accuracy) from system evaluation (behavior). Use evals to pick your model. Use behavioral tests to ensure your agent system is safe and reliable.

Works with OpenAI, Anthropic, LangChain, and OpenClaw trace formats.

Paper/formal writeup in progress. Feedback on the methodology welcome.

GitHub: https://github.com/NeuZhou/agentprobe

---

## r/programming — Developer Experience

**Title:** I built "Playwright for AI Agents" — behavioral testing in YAML with CI integration

**Body:**

If you're building AI agents and testing them by... running them a few times and checking the output looks right... I feel your pain.

**AgentProbe** brings proper testing to AI agents:

```yaml
tests:
  - name: Agent searches before answering
    input: "Weather in Tokyo?"
    expect:
      tool_called: web_search
      output_contains: Tokyo
      max_tokens: 4000

  - name: Handles API failure gracefully
    fault:
      tool: weather_api
      mode: timeout
    expect:
      output_contains: "try again"
      max_steps: 5
```

```bash
$ agentprobe run tests/ --coverage

✓ Agent searches before answering (12ms)
✓ Handles API failure gracefully (8ms)
2/2 passed | Coverage: 85% tools tested
```

**Dev features:**
- YAML tests, no code required
- Watch mode (`--watch`)
- Snapshot testing (like Jest)
- Tool mocking
- Coverage reports
- JUnit output for CI
- GitHub Actions template (`agentprobe init --ci github`)
- Trace diff between versions

TypeScript, MIT, `npm install -g @neuzhou/agentprobe`

GitHub: https://github.com/NeuZhou/agentprobe

---

## r/opensource — Community

**Title:** AgentProbe — open source behavioral testing for AI agents (MIT, TypeScript)

**Body:**

Releasing **AgentProbe** v0.9 — a behavioral testing framework for AI agents.

**Why it exists:** There's no Playwright/Jest equivalent for AI agents. Eval benchmarks test model accuracy but miss behavioral bugs (wrong tool calls, infinite loops, security vulnerabilities, budget overruns).

**What it does:**
- Write agent tests in YAML
- 14+ assertion types (tool calls, sequences, budgets, security, LLM-as-Judge)
- Fault injection (chaos engineering for agents)
- 30+ security attack patterns
- Trace replay from OpenAI/Anthropic/LangChain/OpenClaw
- CI-ready with JUnit output

**Stack:** TypeScript, zero heavy dependencies, MIT licensed.

**Contributing:** The project has a CONTRIBUTING.md and is actively looking for:
- New assertion types
- More trace format adapters (CrewAI, AutoGen, DSPy)
- Security attack patterns
- Documentation improvements

GitHub: https://github.com/NeuZhou/agentprobe
npm: https://www.npmjs.com/package/@neuzhou/agentprobe

Feedback, issues, and PRs welcome!
