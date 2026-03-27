# CLI Reference

AgentProbe ships with 80+ CLI commands. This reference covers the most commonly used ones.
Run `agentprobe --help` for the full list, or `agentprobe <command> --help` for details on any command.

## agentprobe run

Run test suite(s) from YAML file(s).

```bash
agentprobe run <path>                     # Run tests from file or directory
agentprobe run tests/                     # Run all tests in directory
agentprobe run tests/ -f json             # Output as JSON
agentprobe run tests/ -f junit            # JUnit XML for CI
agentprobe run tests/ -t smoke            # Filter by tag
agentprobe run tests/ -g "booking"        # Filter by group name
agentprobe run tests/ -w                  # Watch mode: re-run on file changes
agentprobe run tests/ --coverage          # Show tool coverage report
agentprobe run tests/ -r                  # Find all YAML files recursively
```

**Options:**

| Flag | Description |
|---|---|
| `-f, --format <fmt>` | Output format: `console`, `json`, `markdown` |
| `-o, --output <path>` | Write results to file |
| `-w, --watch` | Watch mode: re-run tests on file change |
| `-u, --update-snapshots` | Update snapshot files |
| `-t, --tag <tags...>` | Filter tests by tags |
| `-g, --group <name>` | Filter tests by group name |
| `--coverage` | Show tool coverage report |
| `--tools <tools...>` | Declared tools for coverage (space-separated) |
| `--compare-baseline` | Compare results against saved baseline |
| `--env-file <path>` | Load environment variables from a .env file |
| `--badge <path>` | Generate a shields.io-style badge SVG |
| `--profile <name>` | Use an environment profile from `.agentproberc.yml` |
| `--theme <name>` | Theme for HTML reports: `dark`, `corporate`, `minimal` |
| `--trace-dir <dir>` | Watch trace directory (with `--watch`) |
| `-r, --recursive` | Find all `.yaml`/`.yml` files recursively in directories |

## agentprobe record

Record an agent execution trace for replay and test generation.

```bash
agentprobe record -s agent.js             # Record agent script
agentprobe record -s agent.js -o trace.json  # Save trace to file
```

## agentprobe replay

Replay a recorded trace and validate expectations.

```bash
agentprobe replay trace.json              # Replay and verify
```

## agentprobe init

Create an example test file (interactive or quick).

```bash
agentprobe init                           # Interactive setup
agentprobe init -y                        # Quick setup with defaults
```

## agentprobe codegen

Generate YAML tests from a recorded trace.

```bash
agentprobe codegen trace.json             # Generate YAML tests
agentprobe codegen trace.json -o tests/   # Output to directory
```

## agentprobe validate

Validate a test suite YAML or trace JSON without running it.

```bash
agentprobe validate tests.yaml            # Validate test suite
agentprobe validate trace.json            # Validate trace file
```

## agentprobe generate-security

Generate a security test suite with built-in attack patterns.

```bash
agentprobe generate-security              # Generate security tests
agentprobe generate-security -o tests/security.yaml  # Output to file
```

## agentprobe chaos

Run chaos testing against agent traces.

```bash
agentprobe chaos chaos-config.yaml        # Run chaos scenarios from config
agentprobe chaos chaos-config.yaml --scenario tool_failure  # Run specific scenario
agentprobe chaos tests.yaml --config chaos.yaml  # Use separate chaos config
```

> **Note:** The test file must contain a `chaos.scenarios` array. If the file doesn't have chaos configuration, use `agentprobe run` for normal tests.

## agentprobe compliance

Check traces against compliance policies.

```bash
agentprobe compliance traces/ --policy policy.yaml  # Check against a policy
```

## agentprobe convert

Convert a trace from external format (OpenAI/Anthropic/LangChain/JSONL) to AgentTrace.

```bash
agentprobe convert trace.json             # Auto-detect source format
agentprobe convert trace.json -f openai   # Specify source format
agentprobe convert trace.json -o out.json # Output to file
```

**Options:**

| Flag | Description |
|---|---|
| `-f, --from <format>` | Source format (auto-detect if omitted) |
| `-o, --output <path>` | Output file (stdout if omitted) |

## agentprobe profile

Analyze trace performance: latency percentiles, cost, bottlenecks.

```bash
agentprobe profile traces/                # Profile all traces in directory
```

## agentprobe stats

Analyze all traces in a directory and show summary statistics.

```bash
agentprobe stats traces/                  # Show trace summary statistics
```

## agentprobe diff

Compare two test run JSON reports side-by-side.

```bash
agentprobe diff run1.json run2.json       # Compare two runs
```

## agentprobe ci

Generate CI/CD workflow templates.

```bash
agentprobe ci github-actions              # GitHub Actions workflow
agentprobe ci gitlab                      # GitLab CI config
agentprobe ci azure-pipelines             # Azure Pipelines
agentprobe ci jenkins                     # Jenkinsfile
```

## agentprobe portal

Generate a static HTML test dashboard.

```bash
agentprobe portal reports/ -o report.html # HTML dashboard
```

## agentprobe health

Check connectivity to LLM adapters.

```bash
agentprobe health                         # Check adapter health
```

## agentprobe mcp

MCP (Model Context Protocol) server — expose AgentProbe as tools for AI agents.

```bash
agentprobe mcp serve                      # Start MCP server
agentprobe mcp tools                      # List available tools
agentprobe mcp config                     # Show config
```

## agentprobe golden

Golden test pattern — record and verify reference runs.

```bash
agentprobe golden record <suite>          # Record golden reference
agentprobe golden verify <suite>          # Verify against golden
```

## agentprobe templates

List available assertion templates.

```bash
agentprobe templates                      # Show all templates
```

## Global Options

| Flag | Description |
|---|---|
| `--help` | Show help |
| `--version` | Show version |
| `--config <path>` | Path to config file |
| `--quiet` | Suppress non-error output |
| `--no-color` | Disable colored output |
