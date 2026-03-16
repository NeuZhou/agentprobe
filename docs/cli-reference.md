# CLI Reference

## agentprobe run

Run test suites.

```bash
agentprobe run <path>             # Run tests from file or directory
agentprobe run tests/             # Run all tests in directory
agentprobe run tests/ -f json     # Output as JSON
agentprobe run tests/ -f junit    # JUnit XML for CI
agentprobe run tests/ --tag smoke # Filter by tag
agentprobe run tests/ --grep "booking"  # Filter by name
agentprobe run tests/ --parallel 4      # Parallel execution
agentprobe run tests/ --bail            # Stop on first failure
agentprobe run tests/ --retries 3       # Retry failed tests
agentprobe run tests/ --timeout 30000   # Timeout per test (ms)
```

**Options:**

| Flag | Description |
|---|---|
| `-f, --format <fmt>` | Output format: `console`, `json`, `junit`, `html` |
| `-o, --output <path>` | Write results to file |
| `--tag <tag>` | Run only tests with this tag |
| `--grep <pattern>` | Run tests matching name pattern |
| `--parallel <n>` | Run n tests concurrently |
| `--bail` | Stop on first failure |
| `--retries <n>` | Retry failed tests n times |
| `--timeout <ms>` | Per-test timeout |
| `--adapter <name>` | Override adapter |
| `--model <name>` | Override model |
| `--verbose` | Verbose output |

## agentprobe watch

Watch mode with hot reload.

```bash
agentprobe watch tests/           # Re-run on file changes
```

## agentprobe record

Record an agent trace for replay and test generation.

```bash
agentprobe record -s agent.js     # Record agent script
agentprobe record -s agent.js -o trace.json  # Save trace
```

## agentprobe security

Run security scans.

```bash
agentprobe security tests/                    # Standard security scan
agentprobe security tests/ --depth deep       # Deep scan
agentprobe security tests/ --depth quick      # Quick scan
agentprobe security --mcp-config mcp.json --scan-tools  # MCP analysis
agentprobe security --generate --output tests/security.test.yaml  # Generate security tests
```

## agentprobe compliance

Compliance audit.

```bash
agentprobe compliance check                   # Run all frameworks
agentprobe compliance check --framework gdpr  # Specific framework
agentprobe compliance check --dir tests/      # Scan directory
agentprobe compliance report --output report.html  # Generate report
```

## agentprobe contract

Verify behavioral contracts.

```bash
agentprobe contract verify <file>             # Verify single contract
agentprobe contract verify contracts/         # Verify all contracts
agentprobe contract verify contracts/ --strict  # Treat warnings as errors
agentprobe contract diff v1.yaml v2.yaml      # Compare contracts
```

## agentprobe profile

Performance profiling.

```bash
agentprobe profile tests/                     # Profile all tests
agentprobe profile tests/ --runs 10           # Run 10 iterations
agentprobe profile tests/ -f json             # JSON output
```

## agentprobe codegen

Generate tests from traces.

```bash
agentprobe codegen trace.json                 # Generate YAML tests
agentprobe codegen trace.json -o tests/       # Output to directory
```

## agentprobe diff

Compare test runs.

```bash
agentprobe diff run1.json run2.json           # Compare two runs
```

## agentprobe init

Scaffold a new project.

```bash
agentprobe init                               # Interactive setup
agentprobe init --adapter openai              # Pre-configured
```

## agentprobe doctor

Check setup health.

```bash
agentprobe doctor                             # Verify environment
```

## agentprobe portal

Generate a dashboard.

```bash
agentprobe portal -o report.html              # HTML dashboard
```

## agentprobe ci

Generate CI configuration.

```bash
agentprobe ci github-actions                  # GitHub Actions workflow
agentprobe ci gitlab                          # GitLab CI config
agentprobe ci azure-pipelines                 # Azure Pipelines
agentprobe ci jenkins                         # Jenkinsfile
```

## Global Options

| Flag | Description |
|---|---|
| `--help` | Show help |
| `--version` | Show version |
| `--config <path>` | Path to config file |
| `--verbose` | Verbose output |
| `--quiet` | Suppress non-error output |
| `--no-color` | Disable colored output |
