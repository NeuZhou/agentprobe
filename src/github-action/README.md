# AgentProbe GitHub Action

Run AgentProbe test suites in your CI pipeline.

## Usage

```yaml
name: Agent Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: NeuZhou/agentprobe-action@v1
        with:
          suite: tests/
          budget: 5.00
          fail_on_regression: true
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

## Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `suite` | Path to test suite | `tests/` |
| `budget` | Max budget (USD) | `5.00` |
| `fail_on_regression` | Fail on regression | `true` |
| `format` | Output format | `junit` |
| `tags` | Filter by tags | |
| `env_file` | Path to .env file | |
| `baseline` | Baseline file path | |

## Outputs

| Output | Description |
|--------|-------------|
| `passed` | Tests passed |
| `failed` | Tests failed |
| `total` | Total tests |
| `report_path` | Report file path |
| `regression_detected` | Regression found |
