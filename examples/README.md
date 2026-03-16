# AgentProbe Examples

Comprehensive examples to get you started with AgentProbe testing.

## 📋 Table of Contents

| Category | Example | Description |
|----------|---------|-------------|
| **Basic** | [hello-world.yaml](basic/hello-world.yaml) | Simplest possible test — verify an agent responds |
| **Basic** | [multi-assertion.yaml](basic/multi-assertion.yaml) | Multiple assertions on a single response |
| **Tools** | [mock-tools.yaml](tools/mock-tools.yaml) | Mock tool responses for deterministic testing |
| **Tools** | [fault-injection.yaml](tools/fault-injection.yaml) | Inject tool failures to test error handling |
| **Security** | [prompt-injection.yaml](security/prompt-injection.yaml) | Test resistance to prompt injection attacks |
| **Security** | [data-exfil.yaml](security/data-exfil.yaml) | Detect data exfiltration attempts |
| **Contracts** | [support-agent.yaml](contracts/support-agent.yaml) | Contract testing for a customer support agent |
| **Chaos** | [tool-failures.yaml](chaos/tool-failures.yaml) | Chaos testing with random tool failures |
| **Multi-Agent** | [handoff.yaml](multi-agent/handoff.yaml) | Multi-agent orchestration and handoff |
| **Compliance** | [gdpr-audit.yaml](compliance/gdpr-audit.yaml) | GDPR compliance verification |
| **CI** | [github-actions.yml](ci/github-actions.yml) | GitHub Actions workflow integration |
| **CI** | [gitlab-ci.yml](ci/gitlab-ci.yml) | GitLab CI pipeline integration |
| **Adapters** | [openai.yaml](adapters/openai.yaml) | OpenAI adapter configuration |
| **Adapters** | [anthropic.yaml](adapters/anthropic.yaml) | Anthropic adapter configuration |
| **MCP** | [mcp-security-scan.yaml](mcp/mcp-security-scan.yaml) | MCP server security scanning |

## 🚀 Quick Start

```bash
# Run a single example
npx agentprobe run examples/basic/hello-world.yaml

# Run all examples in a category
npx agentprobe run examples/security/

# Run all examples
npx agentprobe run examples/
```

## 📖 Writing Your Own Tests

Each YAML file follows the AgentProbe test format:

```yaml
name: "Test Name"
description: "What this test verifies"
agent:
  adapter: openai          # or anthropic, custom, etc.
  model: gpt-4o-mini
steps:
  - send: "Your prompt"
    assert:
      - type: contains
        value: "expected output"
```

See individual examples for advanced patterns like tool mocking, fault injection, and multi-agent testing.
