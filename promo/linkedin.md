# LinkedIn Post — AgentProbe

---

**Why your AI agents need behavioral testing before going to production**

We wouldn't ship a web app without tests. We wouldn't deploy an API without contract validation. But AI agents? Most teams demo them, eyeball the output, and ship.

Here's the gap: **eval benchmarks test the model. Nobody tests the system.**

When an AI agent goes to production, the risks aren't about accuracy — they're about behavior:
• Does the agent call the right tools in the right order?
• What happens when a downstream API times out?
• Can users trick the agent into leaking its system prompt?
• Will a single bad query trigger a $500 token spiral?

These are behavioral bugs. They don't show up in benchmarks. They show up in production incident reports.

I've been working on this problem and built **AgentProbe** — an open source behavioral testing framework for AI agents. Think Playwright, but for agent tool calls, decision sequences, and security boundaries.

Key capabilities:
🔬 Write tests in YAML — assert on tool calls, sequences, budgets, outputs
💥 Fault injection — chaos engineering for agents (simulate failures, timeouts, corrupted data)
🛡️ 30+ security attack patterns — prompt injection, data exfiltration, privilege escalation
🔄 CI integration — runs in GitHub Actions, outputs JUnit, catches regressions automatically

The framework is MIT licensed and works with traces from OpenAI, Anthropic, LangChain, and other agent frameworks.

If you're building agents for production, behavioral testing isn't optional — it's the missing layer between "it works in the demo" and "it works at scale."

GitHub: https://github.com/NeuZhou/agentprobe

I'd love to hear from teams already shipping agents: what behavioral failures have you encountered in production?

#AIAgents #Testing #OpenSource #DevTools #AISafety
