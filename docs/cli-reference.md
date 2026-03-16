# CLI Reference

## Core Commands

### `agentprobe run <suite...>`

Run test suite(s) from YAML files.

```bash
agentprobe run tests.yaml
agentprobe run tests/*.yaml
agentprobe run tests/ --recursive
```

**Options:**
| Flag | Description | Default |
|---|---|---|
| `-f, --format <fmt>` | Output format: `console`, `json`, `markdown`, `html`, `junit` | `console` |
| `-o, --output <path>` | Write results to file | stdout |
| `-w, --watch` | Re-run on file changes | off |
| `-u, --update-snapshots` | Update snapshot files | off |
| `-t, --tag <tags...>` | Filter tests by tags | all |
| `--coverage` | Show tool coverage report | off |
| `--tools <tools...>` | Declared tools for coverage | — |
| `--compare-baseline` | Compare against saved baseline | off |
| `--env-file <path>` | Load `.env` file | — |
| `--badge <path>` | Generate SVG badge | — |
| `--profile <name>` | Use config profile | — |
| `--trace-dir <dir>` | Watch trace directory | — |
| `-r, --recursive` | Find YAML files recursively | off |
| `--sample <N>` | Run N random tests | all |
| `--sample-pct <P>` | Run P% of tests | 100 |
| `--prioritize` | Smart test ordering | off |

### `agentprobe record`

Record an agent trace.

```bash
agentprobe record -s agent.js -o trace.json
agentprobe record -s agent.js -o trace.json --adapter openai
```

### `agentprobe replay <trace>`

Replay a recorded trace.

```bash
agentprobe replay trace.json
agentprobe replay trace.json --deterministic --seed 42
```

### `agentprobe init`

Interactive project setup — creates sample test files and configuration.

```bash
agentprobe init
agentprobe init --ci github   # Include CI config
```

## Generation Commands

### `agentprobe generate <description>`

Generate test YAML from natural language.

```bash
agentprobe generate "Test that my agent calls search and returns results"
agentprobe generate "Verify the agent stays under budget" -o tests/budget.yaml
```

### `agentprobe codegen <trace>`

Generate tests from a recorded trace.

```bash
agentprobe codegen trace.json -o tests/generated.yaml
```

### `agentprobe generate-security`

Generate a security test suite with 30+ attack patterns.

```bash
agentprobe generate-security -o tests/security.yaml
```

### `agentprobe generate-openapi <spec>`

Generate tests from an OpenAPI specification.

```bash
agentprobe generate-openapi openapi.yaml -o tests/api.yaml
```

## Analysis Commands

### `agentprobe profile <traces/>`

Performance profiling with percentiles.

```bash
agentprobe profile traces/
# Shows p50, p95, p99 latency, token efficiency, cost per query, bottlenecks
```

### `agentprobe stats <traces/>`

Aggregate statistics across traces.

```bash
agentprobe stats traces/
```

### `agentprobe trace view <trace>`

Visual trace inspection in terminal.

```bash
agentprobe trace view trace.json
```

### `agentprobe trace diff <a> <b>`

Compare two traces for behavioral drift.

```bash
agentprobe trace diff old.json new.json
```

### `agentprobe trace timeline <trace>`

Gantt-style timeline visualization.

```bash
agentprobe trace timeline trace.json
```

### `agentprobe trace anonymize <trace>`

Redact PII (API keys, emails, IPs, names, phone numbers).

```bash
agentprobe trace anonymize trace.json -o safe-trace.json
```

### `agentprobe trace export`

Export traces to other formats.

```bash
agentprobe trace export trace.json --format otel
agentprobe trace export trace.json --format langsmith
agentprobe trace export trace.json --format csv
```

### `agentprobe search <query> <traces/>`

Search across multiple traces.

```bash
agentprobe search "web_search" traces/
agentprobe search --model gpt-4 --min-cost 0.01 traces/
```

## Quality Commands

### `agentprobe validate <suite>`

Validate YAML structure without running tests.

```bash
agentprobe validate tests/agent.test.yaml
```

### `agentprobe golden record/verify`

Golden test management.

```bash
agentprobe golden record tests.yaml -o golden/
agentprobe golden verify tests.yaml --golden golden/
```

### `agentprobe baseline save/compare`

Regression baselines.

```bash
agentprobe baseline save results.json
agentprobe run tests.yaml --compare-baseline
```

### `agentprobe compliance <traces/>`

Run compliance checks against policy.

```bash
agentprobe compliance traces/ --policy compliance.yml
```

### `agentprobe simulate`

Generate synthetic traces.

```bash
agentprobe simulate --agent research --steps 5 --tools search,summarize --seed 42
```

## Utility Commands

### `agentprobe convert <trace>`

Convert trace formats.

```bash
agentprobe convert openai-trace.json -o native.json
```

### `agentprobe deps --graph`

Generate test dependency graph (Mermaid).

```bash
agentprobe deps tests.yaml --graph
```

### `agentprobe health`

Check project health and setup.

```bash
agentprobe health
```

### `agentprobe plugin list/install`

Plugin management.

```bash
agentprobe plugin list
agentprobe plugin install agentprobe-plugin-slack
```

### `agentprobe report-compare`

Compare two test reports.

```bash
agentprobe report-compare old.json new.json --output delta.html
```

## Global Options

| Flag | Description |
|---|---|
| `-V, --version` | Show version |
| `-h, --help` | Show help |
