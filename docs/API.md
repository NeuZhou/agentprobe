# AgentProbe API Reference

> For getting started, installation, and overview, see the [README](../README.md).

## Table of Contents

- [Core API](#core-api)
- [Assertions](#assertions)
- [Mocking](#mocking)
- [Fault Injection](#fault-injection)
- [LLM-as-Judge](#llm-as-judge)
- [Recorder](#recorder)
- [Trace Adapters](#trace-adapters)
- [Security Testing](#security-testing)
- [Plugin System](#plugin-system)
- [Reporters](#reporters)
- [Types](#types)
- [CLI Reference](#cli-reference)

---

## Core API

### `runSuite(suitePath: string, options?: RunOptions): Promise<SuiteResult>`

Run a YAML test suite and return results.

```typescript
import { runSuite } from 'agentprobe';

const results = await runSuite('tests/agent.yaml', {
  tags: ['smoke'],
  updateSnapshots: false,
  envFile: '.env.test',
});

console.log(`${results.passed}/${results.total} passed`);
process.exit(results.failed > 0 ? 1 : 0);
```

**Options:**

| Field | Type | Description |
|-------|------|-------------|
| `tags` | `string[]` | Filter tests by tags |
| `group` | `string` | Filter by group name |
| `updateSnapshots` | `boolean` | Update snapshot files |
| `envFile` | `string` | Load env vars from file |

### `evaluate(trace: AgentTrace, expect: Expectations): AssertionResult[]`

Evaluate a trace against expectations programmatically.

```typescript
import { evaluate, loadTrace } from 'agentprobe';

const trace = loadTrace('traces/weather.json');
const results = evaluate(trace, {
  tool_called: 'web_search',
  output_contains: 'Tokyo',
  max_steps: 10,
  max_cost_usd: 0.05,
});

for (const r of results) {
  console.log(`${r.passed ? '✅' : '❌'} ${r.name}`);
}
```

### `loadTrace(filePath: string): AgentTrace`

Load a trace JSON file.

### `report(result: SuiteResult, format: ReportFormat, theme?: string): string`

Format results as `console`, `json`, `markdown`, `html`, or `junit`.

---

## Assertions

All assertions available in YAML `expect:` blocks and via `evaluate()`.

### Basic Assertions

| Assertion | Type | Description |
|-----------|------|-------------|
| `tool_called` | `string \| string[]` | Tool(s) must have been called |
| `tool_not_called` | `string \| string[]` | Tool(s) must NOT have been called |
| `output_contains` | `string \| string[]` | Output must contain substring(s) |
| `output_not_contains` | `string \| string[]` | Output must NOT contain substring(s) |
| `output_matches` | `string` | Output must match regex |
| `max_steps` | `number` | Maximum trace steps allowed |
| `max_tokens` | `number` | Maximum total tokens |
| `max_duration_ms` | `number` | Maximum execution time |
| `max_cost_usd` | `number` | Maximum estimated cost in USD |
| `snapshot` | `boolean` | Snapshot testing (like Jest) |

### Advanced Assertions

| Assertion | Type | Description |
|-----------|------|-------------|
| `tool_sequence` | `string[]` | Tools must be called in this order |
| `tool_args_match` | `Record<string, any>` | Verify tool call arguments |
| `chain` | `ChainStep[]` | Sequential step validation |
| `custom` | `string` | Custom JS expression |
| `judge` | `JudgeSpec` | LLM-as-Judge evaluation |
| `judge_rubric` | `RubricCriterion[]` | Multi-criteria LLM judging |

### Composed Assertions

| Assertion | Type | Description |
|-----------|------|-------------|
| `all_of` | `Expectations[]` | ALL must pass (AND) |
| `any_of` | `Expectations[]` | At least one must pass (OR) |
| `none_of` | `Expectations[]` | NONE must pass (NOR) |
| `not` | `Expectations` | Negate an expectation |

### YAML Examples

```yaml
tests:
  # Basic: tool must be called, output checked
  - name: Weather lookup
    input: "What's the weather in Tokyo?"
    trace: traces/weather.json
    expect:
      tool_called: web_search
      output_contains: Tokyo
      max_steps: 10

  # Tool sequence validation
  - name: Research agent flow
    input: "Research quantum computing"
    trace: traces/research.json
    expect:
      tool_sequence: [web_search, summarize, write_file]

  # Composed assertions
  - name: Either search or browse
    input: "Find latest news"
    trace: traces/news.json
    expect:
      any_of:
        - tool_called: web_search
        - tool_called: browse_url

  # Chain assertion
  - name: Multi-step workflow
    input: "Analyze this data"
    trace: traces/analysis.json
    expect:
      chain:
        - tool_called: read_file
        - tool_called: analyze
          output_contains: "result"

  # Parameterized tests
  - name: "Weather in ${city}"
    input: "Weather in ${city}?"
    trace: traces/weather.json
    each:
      - city: Tokyo
      - city: London
      - city: "New York"
    expect:
      tool_called: web_search
      output_contains: "${city}"

  # With tags and dependencies
  - name: Setup data
    id: setup
    input: "Create test file"
    trace: traces/setup.json
    tags: [setup]
    expect:
      tool_called: write_file

  - name: Process data
    input: "Process the test file"
    trace: traces/process.json
    depends_on: setup
    tags: [integration]
    expect:
      tool_called: read_file
```

---

## Mocking

### `class MockToolkit`

Jest-style tool mocking for agent tests.

```typescript
import { MockToolkit } from 'agentprobe';

const mocks = new MockToolkit();

// Basic mock
const searchMock = mocks.mock('web_search', (args) => ({
  results: [{ title: 'Test', url: 'https://example.com' }],
}));

// Return fixed value once
mocks.mockOnce('get_weather', { temp: 72, unit: 'F' });

// Return values in sequence
mocks.mockSequence('database_query', [
  { rows: [] },
  { rows: [{ id: 1, name: 'test' }] },
]);

// Mock to throw an error
mocks.mockError('failing_api', 'Service unavailable');

// Call a mock
const result = mocks.call('web_search', { query: 'test' });

// Inspect calls
console.log(searchMock.callCount);       // 1
console.log(searchMock.calls[0].args);   // { query: 'test' }

// Check if mock exists
mocks.has('web_search');  // true

// Reset all mocks
mocks.reset();
```

**YAML integration:**

```yaml
tests:
  - name: With mocked tools
    input: "Search for cats"
    mocks:
      web_search:
        results: [{ title: "Cats", url: "https://cats.com" }]
    expect:
      tool_called: web_search
      output_contains: Cats
```

---

## Fault Injection

### `class FaultInjector`

Chaos engineering for AI agents — inject failures to test resilience.

```typescript
import { FaultInjector } from 'agentprobe';

const injector = new FaultInjector({
  web_search: { type: 'error', message: 'API rate limited' },
  database:   { type: 'timeout', delay_ms: 30000 },
  weather:    { type: 'slow', delay_ms: 5000 },
  parser:     { type: 'corrupt' },
  flaky_api:  { type: 'error', message: 'Intermittent', probability: 0.3 },
});

// Check if fault applies
injector.shouldInject('web_search');  // true (probability=1.0)

// Wrap a tool call
try {
  const result = await injector.wrapToolCall('web_search', async () => {
    return fetch('https://api.search.com/search');
  });
} catch (err) {
  // FaultInjectionError: API rate limited
  console.log(err.toolName, err.faultConfig);
}
```

**Fault types:**

| Type | Description |
|------|-------------|
| `error` | Throws `FaultInjectionError` with custom message |
| `timeout` | Delays then throws timeout error |
| `slow` | Adds delay but returns normally |
| `corrupt` | Returns `{ corrupted: true, original: null }` |

**YAML integration:**

```yaml
tests:
  - name: Handles API failure gracefully
    input: "Search for data"
    faults:
      web_search:
        type: error
        message: "503 Service Unavailable"
    expect:
      output_contains: "sorry"
      tool_not_called: exec
```

---

## LLM-as-Judge

Use an LLM to evaluate output quality with caching.

### Single Criterion

```yaml
tests:
  - name: Helpful response
    input: "Explain quantum computing"
    trace: traces/quantum.json
    expect:
      judge:
        criteria: "Response is accurate, clear, and educational"
        model: gpt-4o-mini    # optional, default: gpt-4o-mini
        threshold: 0.7         # optional, default: 0.7
```

### Multi-Criteria Rubric

```yaml
tests:
  - name: Quality response
    input: "Write a summary of AI trends"
    trace: traces/summary.json
    expect:
      judge_rubric:
        - criterion: "Factually accurate"
          weight: 3
        - criterion: "Well-structured"
          weight: 2
        - criterion: "Concise"
          weight: 1
```

### Programmatic API

```typescript
import { judgeOutput, judgeWithRubric } from 'agentprobe/judge';

const result = await judgeOutput(output, {
  criteria: 'Response is helpful and accurate',
  model: 'gpt-4o-mini',
  threshold: 0.7,
});
// { passed: true, score: 0.85, reasoning: '...', model: 'gpt-4o-mini', cached: false }

const rubricResult = await judgeWithRubric(output, {
  rubric: [
    { criterion: 'Accuracy', weight: 3 },
    { criterion: 'Clarity', weight: 2 },
  ],
  threshold: 0.7,
});
// { passed: true, overallScore: 0.82, scores: [...], cached: false }
```

Results are cached in `.agentprobe-cache/` to avoid repeated LLM calls.

---

## Recorder

Record live agent executions as traces.

### `class Recorder`

```typescript
import { Recorder } from 'agentprobe';

const recorder = new Recorder({ recorded_at: new Date().toISOString() });

// Auto-patch OpenAI/Anthropic SDKs
recorder.patchOpenAI(require('openai'));
recorder.patchAnthropic(require('@anthropic-ai/sdk'));

// Run your agent
await myAgent.run('What is the weather?');

// Save the trace
recorder.save('traces/weather.json');
```

---

## Trace Adapters

Auto-convert traces from other formats.

### Built-in Adapters

| Adapter | Detects |
|---------|---------|
| `openai` | OpenAI chat completions |
| `anthropic` | Anthropic message format |
| `langchain` | LangChain run traces |
| `gemini` | Google Gemini responses |
| `ollama` | Ollama completions |
| `openai-compatible` | OpenAI-compatible APIs |
| `openclaw` | OpenClaw native format |
| `generic` | Generic event logs |

### Auto-Detection

```typescript
import { autoConvert, convertWith } from 'agentprobe/adapters';

// Auto-detect format
const trace = autoConvert(rawData);

// Explicit format
const trace2 = convertWith('openai', rawOpenAIData);
```

### Writing a Custom Adapter

```typescript
import type { TraceAdapter, AgentTrace } from 'agentprobe';

const myAdapter: TraceAdapter = {
  name: 'my-platform',
  detect: (input) => !!input?.my_platform_version,
  convert: (input): AgentTrace => ({
    id: input.id,
    timestamp: input.created_at,
    steps: input.events.map(e => ({
      type: e.kind === 'tool' ? 'tool_call' : 'llm_call',
      timestamp: e.timestamp,
      data: { tool_name: e.name, content: e.output },
      duration_ms: e.duration,
    })),
    metadata: { source: 'my-platform' },
  }),
};
```

---

## Security Testing

### `generateSecurityTests(options?: { categories?: string[] }): TestCase[]`

Generate built-in security test suites.

```typescript
import { generateSecurityTests } from 'agentprobe';

const tests = generateSecurityTests({
  categories: ['injection', 'exfiltration', 'privilege', 'harmful'],
});
```

**Categories:**
- `injection` — Prompt injection attempts
- `exfiltration` — Data leak attempts
- `privilege` — Privilege escalation
- `harmful` — Harmful content generation

---

## Plugin System

### Configuration (`.agentproberc.yml`)

```yaml
plugins:
  - agentprobe-plugin-cache
  - agentprobe-plugin-cost-tracker
  - ./my-local-plugin

adapters:
  default: openai

profiles:
  staging:
    model: gpt-4o-mini
    adapter: openai
    env:
      API_KEY: staging-key
    timeout_ms: 30000

  production:
    model: gpt-4o
    adapter: openai

ci:
  fail_on_regression: true
```

### Built-in Plugins

| Plugin | Description |
|--------|-------------|
| `cache` | Response caching for faster reruns |
| `cost-tracker` | Track API costs per test |
| `coverage` | Tool coverage analysis |
| `retry` | Auto-retry flaky tests |

---

## Reporters

### Available Formats

| Format | Output |
|--------|--------|
| `console` | Colorized terminal output |
| `json` | Machine-readable JSON |
| `markdown` | Markdown table |
| `html` | Interactive HTML report with themes |
| `junit` | JUnit XML for CI integration |

### HTML Themes

| Theme | Description |
|-------|-------------|
| `dark` | Dark mode dashboard |
| `corporate` | Clean enterprise look |
| `minimal` | Minimal styling |

```bash
agentprobe run tests.yaml -f html --theme dark -o report.html
```

---

## Types

### Core Types

```typescript
interface AgentTrace {
  id: string;
  timestamp: string;
  steps: TraceStep[];
  metadata: Record<string, any>;
}

type StepType = 'llm_call' | 'tool_call' | 'tool_result' | 'thought' | 'output';

interface TraceStep {
  type: StepType;
  timestamp: string;
  data: {
    model?: string;
    messages?: Message[];
    tool_name?: string;
    tool_args?: Record<string, any>;
    tool_result?: any;
    content?: string;
    tokens?: { input?: number; output?: number };
  };
  duration_ms?: number;
}

interface TestSuite {
  name: string;
  description?: string;
  config?: TestConfig;
  hooks?: SuiteHooks;
  tests: TestCase[];
}

interface SuiteResult {
  name: string;
  passed: number;
  failed: number;
  total: number;
  duration_ms: number;
  results: TestResult[];
}

interface TestResult {
  name: string;
  passed: boolean;
  assertions: AssertionResult[];
  duration_ms: number;
  trace?: AgentTrace;
  error?: string;
  tags?: string[];
  skipped?: boolean;
  attempts?: number;
}

interface AssertionResult {
  name: string;
  passed: boolean;
  expected?: any;
  actual?: any;
  message?: string;
}

type ReportFormat = 'console' | 'json' | 'markdown' | 'html' | 'junit';
```

---

## CLI Reference

```
agentprobe <command> [options]
```

### Core Commands

| Command | Description |
|---------|-------------|
| `run <suite...>` | Run test suite(s) from YAML files |
| `record` | Record an agent execution trace |
| `replay <trace>` | Replay and display a trace |
| `init` | Interactive project scaffolding |
| `validate <file>` | Validate suite YAML or trace JSON |

### Test Generation

| Command | Description |
|---------|-------------|
| `codegen <trace>` | Generate YAML tests from a trace |
| `generate <description>` | Generate tests from natural language |
| `generate-security` | Generate security test suite |
| `generate-from-openapi <spec>` | Generate tests from OpenAPI spec |
| `gen-from-docs <file>` | Generate tests from API docs |

### Trace Operations

| Command | Description |
|---------|-------------|
| `trace view <file>` | Visual trace inspection |
| `trace timeline <file>` | Gantt-style timeline |
| `trace diff <old> <new>` | Compare two traces |
| `trace compare <a> <b>` | Side-by-side comparison |
| `trace merge <files...>` | Merge multiple traces |
| `trace anonymize <file>` | Remove sensitive data |
| `trace validate <file>` | Validate trace format |
| `trace export <file>` | Export to OTel/LangSmith/CSV |
| `trace enrich <dir>` | Auto-enrich traces with metadata |
| `trace otel <file>` | Export as OTLP JSON |

### Analysis

| Command | Description |
|---------|-------------|
| `stats <dir>` | Summary statistics from traces |
| `profile <dir>` | Performance profiling |
| `search <query> <dir>` | Search across traces |
| `suggest <trace>` | AI-suggest tests to write |
| `fingerprint <dir>` | Behavioral fingerprinting |
| `safety-score <dir>` | Compute agent safety score |
| `coverage-map <suite>` | Visualize capability coverage |
| `behavior-profile <dir>` | Profile behavior patterns |

### Regression & Comparison

| Command | Description |
|---------|-------------|
| `baseline save <suite>` | Save baseline for regression detection |
| `baseline compare <suite>` | Compare against baseline |
| `regression add <suite>` | Add labeled regression snapshot |
| `regression compare <a> <b>` | Compare two snapshots |
| `diff <old> <new>` | Compare two run reports |
| `agent-diff --v1 <dir> --v2 <dir>` | Compare agent versions |
| `perf-check` | Detect performance regressions |

### Testing Utilities

| Command | Description |
|---------|-------------|
| `mutate <suite>` | Mutation testing |
| `flaky <suite>` | Flaky test detection |
| `ab-test` | A/B test two models |
| `chaos <test>` | Chaos testing |
| `matrix <suite>` | Multi-model/temperature matrix |
| `simulate` | Generate synthetic traces |
| `replay-verify <trace>` | Deterministic replay verification |
| `contract <contract> <trace>` | Verify trace against contract |

### CI/CD & DevOps

| Command | Description |
|---------|-------------|
| `ci github-actions` | Generate GitHub Actions workflow |
| `ci gitlab` | Generate GitLab CI pipeline |
| `ci azure-pipelines` | Generate Azure Pipelines YAML |
| `ci circleci` | Generate CircleCI config |
| `badge` | Generate shields.io-style badge |

### Dashboards & Reports

| Command | Description |
|---------|-------------|
| `portal <dir>` | Static HTML test dashboard |
| `studio` | Interactive test studio |
| `health` | Check adapter connectivity |
| `health-dashboard` | Health monitoring dashboard |
| `governance` | Fleet governance dashboard |
| `compliance-report` | Regulated industry compliance |
| `compliance-audit <dir>` | Audit against GDPR/SOC2/HIPAA/PCI-DSS |

### `run` Options

| Flag | Description | Default |
|------|-------------|---------|
| `-f, --format <fmt>` | Output format: console, json, markdown, html, junit | `console` |
| `-o, --output <path>` | Write results to file | — |
| `-w, --watch` | Watch mode | `false` |
| `-u, --update-snapshots` | Update snapshot files | `false` |
| `-t, --tag <tags...>` | Filter by tags | — |
| `-g, --group <name>` | Filter by group | — |
| `--coverage` | Show tool coverage | `false` |
| `--tools <tools...>` | Declared tools for coverage | — |
| `--compare-baseline` | Compare against baseline | `false` |
| `--env-file <path>` | Load .env file | — |
| `--badge <path>` | Generate badge SVG | — |
| `--profile <name>` | Use environment profile | — |
| `--theme <name>` | HTML theme: dark, corporate, minimal | — |
| `-r, --recursive` | Find YAML files recursively | `false` |

### Examples

```bash
# Run tests
agentprobe run tests.yaml
agentprobe run tests/ -r --coverage --tools search browse write

# Watch mode
agentprobe run tests.yaml -w

# Generate from trace
agentprobe record -s agent.js -o trace.json
agentprobe codegen trace.json -o tests/generated.yaml

# Security testing
agentprobe generate-security -o tests/security.yaml
agentprobe run tests/security.yaml --strict

# Performance analysis
agentprobe profile traces/
agentprobe stats traces/ --detailed

# CI integration
agentprobe ci github-actions
agentprobe run tests.yaml -f junit -o results.xml --badge badge.svg

# Compare runs
agentprobe baseline save tests.yaml
agentprobe run tests.yaml --compare-baseline

# Interactive setup
agentprobe init
agentprobe build
```
