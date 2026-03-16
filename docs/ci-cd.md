# CI/CD Integration

## GitHub Actions

### Basic workflow

```yaml
# .github/workflows/agent-tests.yml
name: Agent Tests
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
      - run: npm ci
      - run: npx agentprobe run tests/ --format markdown > agent-report.md
      - run: npx agentprobe run tests/ --badge badge.svg

      # Upload badge as artifact
      - uses: actions/upload-artifact@v4
        with:
          name: agent-badge
          path: badge.svg

      # Post PR comment with results
      - name: Comment on PR
        if: github.event_name == 'pull_request'
        uses: marocchino/sticky-pull-request-comment@v2
        with:
          path: agent-report.md
```

### With security gate

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci

      # Run all tests
      - run: npx agentprobe run tests/

      # Security gate — must pass 100%
      - run: npx agentprobe run tests/security.yaml --tag security
```

### With LLM-as-Judge (requires API key)

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    env:
      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npx agentprobe run tests/
```

### Generate with CLI

```bash
agentprobe init --ci github
```

Creates `.github/workflows/agent-tests.yml` with a sensible default.

## GitLab CI

```yaml
# .gitlab-ci.yml
agent-tests:
  image: node:20
  stage: test
  script:
    - npm ci
    - npx agentprobe run tests/ --format json > agent-results.json
    - npx agentprobe run tests/ --badge badge.svg
  artifacts:
    paths:
      - agent-results.json
      - badge.svg
    reports:
      junit: agent-results.json  # if JSON resembles JUnit
```

## Generic CI

Any CI system that can run Node.js:

```bash
#!/bin/bash
set -e

npm ci
npx agentprobe run tests/

# Exit code 0 = all pass, 1 = failures
```

### Environment variables

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | Required for `judge` / `judge_rubric` assertions |
| `OPENAI_BASE_URL` | Custom API endpoint (Azure, local proxy) |
| `AGENTPROBE_CACHE_DIR` | Override cache directory (default: `.agentprobe-cache`) |

## PR Comments

Generate markdown output for PR comments:

```bash
npx agentprobe run tests/ --format markdown > report.md
```

Example output:

```markdown
## 🔬 AgentProbe Results

| Test | Status | Duration |
|------|--------|----------|
| Agent uses search tool | ✅ Pass | 5ms |
| No prompt injection | ✅ Pass | 3ms |
| Token budget | ❌ Fail | 8ms |

**3/4 passed (75%)**
```

### HTML reports

```bash
npx agentprobe run tests/ --format html > report.html
```

Generates a self-contained HTML file with expandable test details.

## Regression Baselines

Track agent behavior across versions:

```bash
# Create a baseline from current test results
agentprobe baseline create --from tests/ --output baselines/v1.json

# After changes, compare
agentprobe baseline compare --baseline baselines/v1.json --current tests/

# In CI
agentprobe baseline compare --baseline baselines/v1.json --current tests/ --fail-on-regression
```

### What counts as a regression?

- A previously passing test now fails
- Token usage increased by more than a configurable threshold
- New tools are being called that weren't before
- Cost increased beyond threshold

## Badge Generation

```bash
# Generate SVG badge
agentprobe run tests/ --badge badge.svg
```

The badge shows pass rate:

- 🟢 Green: 100% pass
- 🟡 Yellow: 80-99% pass
- 🔴 Red: <80% pass

Add to README:

```markdown
![Agent Tests](./badge.svg)
```

Or host on a CDN / GitHub Pages for dynamic updating:

```yaml
# In CI: commit badge to a branch
- run: |
    git config user.name "CI"
    git config user.email "ci@example.com"
    git checkout badges || git checkout -b badges
    cp badge.svg .
    git add badge.svg
    git commit -m "Update badge" || true
    git push origin badges
```
