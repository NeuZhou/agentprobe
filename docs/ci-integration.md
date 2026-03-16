# CI Integration

AgentProbe integrates seamlessly with CI/CD pipelines. Tests run against recorded traces — no API keys or LLM calls needed in CI.

## GitHub Actions

### Basic Setup

```yaml
# .github/workflows/agent-tests.yml
name: Agent Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npx agentprobe run tests/ -f junit -o results.xml
      - uses: dorny/test-reporter@v1
        if: always()
        with:
          name: AgentProbe Results
          path: results.xml
          reporter: java-junit
```

### With Badge Generation

```yaml
      - run: npx agentprobe run tests/ -f junit -o results.xml --badge badge.svg
      - uses: actions/upload-artifact@v4
        with:
          name: test-badge
          path: badge.svg
```

### With Regression Detection

```yaml
      - run: npx agentprobe run tests/ -f json -o results.json --compare-baseline
      - run: npx agentprobe baseline save results.json
```

### Security Tests on PRs

```yaml
name: Security
on: [pull_request]
jobs:
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npx agentprobe run tests/security.yaml --tag security -f junit -o security.xml
```

## Generate CI Config

```bash
agentprobe init --ci github    # GitHub Actions
agentprobe init --ci gitlab    # GitLab CI
agentprobe init --ci circle    # CircleCI
```

## JUnit XML Output

Most CI systems support JUnit XML:

```bash
agentprobe run tests/ -f junit -o results.xml
```

Works with:
- GitHub Actions (`dorny/test-reporter`)
- GitLab CI (built-in JUnit support)
- CircleCI (`store_test_results`)
- Jenkins (JUnit plugin)
- Azure DevOps (publish test results task)

## HTML Reports

Generate standalone HTML reports:

```bash
agentprobe run tests/ -f html -o report.html
```

Upload as artifact for team review.

## Badge Generation

Generate shields.io-style SVG badges:

```bash
agentprobe run tests/ --badge badge.svg
```

Produces a badge like: ![tests: 42 passed](https://img.shields.io/badge/tests-42%20passed-brightgreen)

## Webhook Notifications

Get notified on failures via Slack, Teams, or Discord:

```yaml
# .agentproberc.yml
webhooks:
  - url: https://hooks.slack.com/services/T00/B00/XXX
    events: [failure, regression]
```

## Test Prioritization

Speed up CI by running likely-to-fail tests first:

```bash
agentprobe run tests/ --prioritize
```

Orders: previously failing → change-affected → slowest last.

## Example: Complete CI Pipeline

```yaml
name: Agent Quality Gate
on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci

      # Run all tests
      - run: npx agentprobe run tests/ -f junit -o results.xml --badge badge.svg --prioritize

      # Security tests
      - run: npx agentprobe run tests/security.yaml --tag security -f json -o security.json

      # Regression check
      - run: npx agentprobe run tests/ --compare-baseline -f json -o current.json

      # Upload results
      - uses: dorny/test-reporter@v1
        if: always()
        with:
          name: AgentProbe
          path: results.xml
          reporter: java-junit

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: test-results
          path: |
            results.xml
            security.json
            badge.svg
```
