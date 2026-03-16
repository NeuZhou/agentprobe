# API Reference

AgentProbe provides a full programmatic TypeScript API alongside its CLI and YAML interfaces.

## Table of Contents

- [Core API](#core-api)
- [Assertion Types](#assertion-types)
- [Adapter Configuration](#adapter-configuration)
- [Plugin Interface](#plugin-interface)
- [Hook Types](#hook-types)
- [Error Codes](#error-codes)

---

## Core API

### `runSuite(suitePath: string, options?: RunOptions): Promise<SuiteResult>`

Run a YAML test suite programmatically.

```typescript
import { runSuite } from '@neuzhou/agentprobe';

const results = await runSuite('tests/agent.test.yaml', {
  tags: ['security'],
  coverage: true,
  badge: 'badge.svg',
});

console.log(`${results.passed}/${results.total} passed`);
```

**RunOptions:**
| Field | Type | Description |
|---|---|---|
| `tags` | `string[]` | Filter tests by tag |
| `coverage` | `boolean` | Enable tool coverage tracking |
| `updateSnapshots` | `boolean` | Update snapshot files |
| `envFile` | `string` | Path to `.env` file |
| `badge` | `string` | Output path for SVG badge |
| `declaredTools` | `string[]` | Expected tools for coverage calculation |

### `evaluate(trace: AgentTrace, expect: Expectations): AssertionResult[]`

Evaluate a single trace against expectations.

```typescript
import { evaluate } from '@neuzhou/agentprobe';

const results = evaluate(trace, {
  tool_called: 'web_search',
  max_steps: 10,
  max_cost_usd: 0.05,
  output_contains: 'Tokyo',
});
```

### `Recorder`

Record agent traces by patching OpenAI/Anthropic SDKs.

```typescript
import { Recorder } from '@neuzhou/agentprobe';

const recorder = new Recorder();
recorder.start();
// ... run your agent ...
const trace = recorder.stop();
recorder.save('traces/my-trace.json');
```

### `profile(traces: AgentTrace[]): ProfileResult`

Profile performance across traces.

```typescript
import { profile } from '@neuzhou/agentprobe';

const perf = profile(traces);
console.log(`p95 latency: ${perf.llm_latency.p95}ms`);
console.log(`Avg cost: $${perf.cost.mean}`);
```

### `report(results: SuiteResult, format: ReportFormat): string`

Format test results.

```typescript
import { report } from '@neuzhou/agentprobe';

const output = report(results, 'junit');
fs.writeFileSync('results.xml', output);
```

**ReportFormat:** `'console' | 'json' | 'markdown' | 'html' | 'junit'`

---

## Assertion Types

### Core Assertions

| Assertion | Type | Description |
|---|---|---|
| `tool_called` | `string \| string[]` | Assert tool(s) were called |
| `tool_not_called` | `string \| string[]` | Assert tool(s) were NOT called |
| `tool_sequence` | `string[]` | Assert exact sequence of tool calls |
| `tool_args_match` | `Record<string, any>` | Assert tool was called with specific arguments |
| `output_contains` | `string \| string[]` | Assert output contains substring(s) |
| `output_not_contains` | `string \| string[]` | Assert output does NOT contain substring(s) |
| `output_matches` | `string` | Assert output matches regex pattern |
| `max_steps` | `number` | Maximum number of trace steps |
| `max_tokens` | `number` | Maximum total tokens used |
| `max_cost_usd` | `number` | Maximum cost in USD |
| `max_duration_ms` | `number` | Maximum execution time in ms |
| `snapshot` | `boolean` | Compare output against saved snapshot |
| `custom` | `string` | Custom JavaScript expression |

### Composed Assertions

| Assertion | Type | Description |
|---|---|---|
| `all_of` | `Expectations[]` | ALL sub-assertions must pass |
| `any_of` | `Expectations[]` | At least ONE sub-assertion must pass |
| `none_of` | `Expectations[]` | NO sub-assertions should pass |
| `not` | `Partial<Expectations>` | Negate any assertion |
| `chain` | `ChainStep[]` | Sequential assertion dependencies |

### LLM-as-Judge

```yaml
expect:
  judge:
    criteria: "Response is helpful, accurate, and concise"
    model: gpt-4
    threshold: 0.8

  judge_rubric:
    - criterion: "Accuracy"
      weight: 3
    - criterion: "Helpfulness"
      weight: 2
    threshold: 0.7
```

### Weighted Scoring

```yaml
expect:
  weighted:
    - assertion: { tool_called: web_search }
      weight: 3
    - assertion: { output_contains: "Tokyo" }
      weight: 2
    - assertion: { max_steps: 10 }
      weight: 1
  pass_threshold: 0.8
```

### Custom Assertions

```typescript
import { registerCustomAssertion } from '@neuzhou/agentprobe';

registerCustomAssertion('no_loops', (trace, params) => ({
  name: 'no_loops',
  passed: new Set(trace.steps.map(s => s.data.tool_name)).size === trace.steps.filter(s => s.type === 'tool_call').length,
  message: 'No duplicate tool calls',
}));
```

---

## Adapter Configuration

Adapters normalize different trace formats into AgentProbe's internal format.

### Supported Adapters

| Adapter | Import | Auto-detect |
|---|---|---|
| OpenAI | `openai` | ✅ |
| Anthropic | `anthropic` | ✅ |
| LangChain | `langchain` | ✅ |
| OpenClaw | `openclaw` | ✅ |
| Generic JSONL | `generic` | ✅ |

### Adapter Interface

```typescript
interface AdapterHandler {
  name: string;
  detect(input: any): boolean;    // Auto-detect if this adapter can handle the input
  convert(input: any): AgentTrace; // Convert to AgentProbe trace format
}
```

### Using Adapters

```typescript
import { detectAdapter, convertTrace } from '@neuzhou/agentprobe';

// Auto-detect and convert
const adapter = detectAdapter(rawTrace);
const trace = adapter.convert(rawTrace);

// Or specify explicitly
import { convertTrace } from '@neuzhou/agentprobe';
const trace = convertTrace(rawTrace, 'anthropic');
```

---

## Plugin Interface

### AgentProbePlugin

```typescript
interface AgentProbePlugin {
  name: string;
  type?: 'reporter' | 'adapter' | 'assertion' | 'lifecycle';
  version?: string;
  assertions?: Record<string, AssertionHandler>;
  reporters?: Record<string, ReporterHandler>;
  adapters?: Record<string, AdapterHandler>;
  hooks?: PluginHooks;
}
```

### Creating a Plugin

```typescript
// my-plugin.ts
import type { AgentProbePlugin } from '@neuzhou/agentprobe';

const plugin: AgentProbePlugin = {
  name: 'my-plugin',
  version: '1.0.0',
  type: 'assertion',
  assertions: {
    response_time_ok: (trace, maxMs) => ({
      name: 'response_time_ok',
      passed: trace.steps.reduce((sum, s) => sum + (s.duration_ms ?? 0), 0) <= maxMs,
      expected: `<= ${maxMs}ms`,
      actual: `${trace.steps.reduce((sum, s) => sum + (s.duration_ms ?? 0), 0)}ms`,
    }),
  },
  hooks: {
    onSuiteComplete: (results) => {
      console.log(`Suite done: ${results.passed}/${results.total}`);
    },
  },
};

export default plugin;
```

### Registering Plugins

**Via config file (`.agentproberc.yml`):**
```yaml
plugins:
  - ./my-plugin.ts
  - @agentprobe/plugin-slack
```

**Via CLI:**
```bash
agentprobe plugin install my-plugin
agentprobe plugin list
```

### Plugin Hooks

```typescript
interface PluginHooks {
  onTestStart?(test: { name: string; input: string }): void | Promise<void>;
  onTestComplete?(result: TestResult): void | Promise<void>;
  onSuiteStart?(suite: { name: string; total: number }): void | Promise<void>;
  onSuiteComplete?(results: SuiteResult): void | Promise<void>;
  onError?(error: Error, context: { test?: string }): void | Promise<void>;
}
```

---

## Hook Types

### YAML Hooks

```yaml
name: My Suite
hooks:
  beforeAll:
    command: "echo Starting tests"
  afterAll:
    command: "echo Tests complete"
  beforeEach:
    command: "echo Running test"
  afterEach:
    command: "echo Test done"
tests:
  - name: Example
    input: "Hello"
    expect:
      output_contains: "Hi"
```

### Programmatic Hooks

```typescript
import { beforeAll, afterAll, beforeEach, afterEach, onFailure } from '@neuzhou/agentprobe';

beforeAll(async () => {
  // Setup: start services, seed data
});

afterAll(async (results) => {
  console.log(`Completed: ${results.passed}/${results.total}`);
});

beforeEach(async (testName) => {
  console.log(`Starting: ${testName}`);
});

afterEach(async (result) => {
  if (!result.passed) console.log(`Failed: ${result.name}`);
});

onFailure(async (testName, error) => {
  // Alert, log, or retry logic
});
```

### Hook Type Signatures

| Hook | Signature |
|---|---|
| `BeforeAllHook` | `() => Promise<void> \| void` |
| `AfterAllHook` | `(results: SuiteResult) => Promise<void> \| void` |
| `BeforeEachHook` | `(testName: string) => Promise<void> \| void` |
| `AfterEachHook` | `(result: TestResult) => Promise<void> \| void` |
| `OnFailureHook` | `(testName: string, error: string) => Promise<void> \| void` |

---

## Error Codes

All AgentProbe errors use structured error codes with hints for resolution.

| Code | Title | Category | Hint |
|---|---|---|---|
| `AP001` | Adapter connection failed | adapter | Check your API key in `.env` or `OPENAI_API_KEY` |
| `AP002` | Trace format invalid | trace | Ensure trace has `steps` array with `type` and `content` |
| `AP003` | Budget exceeded | budget | Current spend exceeds limit. Increase budget or reduce scope |
| `AP004` | Suite file not found | io | Check the path to your test suite YAML file |
| `AP005` | Invalid YAML syntax | config | Check your test suite for YAML syntax errors |
| `AP006` | Test timeout exceeded | test | Increase `timeout_ms` or reduce test complexity |
| `AP007` | Snapshot mismatch | test | Run `agentprobe update-snapshots` or check for regression |
| `AP008` | Adapter not supported | adapter | Supported: openai, anthropic, gemini, azure-openai, ollama |
| `AP009` | Mock configuration invalid | config | Ensure mocks are keyed by tool name with valid return values |
| `AP010` | Circular dependency detected | test | Check `depends_on` fields for circular references |
| `AP011` | Plugin load failed | config | Verify plugin module path and valid plugin interface export |
| `AP012` | Trace file corrupted | trace | Re-record the trace. Ensure valid JSON |
| `AP013` | Assertion syntax error | test | Check `expect` block for valid assertion keys |
| `AP014` | Fixture not found | io | Ensure fixture file exists, path relative to suite file |
| `AP015` | Compression failed | io | Check disk space and file permissions |

### Using Errors Programmatically

```typescript
import { AgentProbeError, getError, getAllErrors } from '@neuzhou/agentprobe';

try {
  // ...
} catch (e) {
  if (e instanceof AgentProbeError) {
    console.log(e.code);     // "AP003"
    console.log(e.hint);     // "Current spend: $5.23, limit: $5.00"
    console.log(e.category); // "budget"
    console.log(e.format()); // Formatted CLI output
  }
}
```

---

## Type Reference

### AgentTrace

```typescript
interface AgentTrace {
  id: string;
  timestamp: string;
  steps: TraceStep[];
  metadata: Record<string, any>;
}
```

### TraceStep

```typescript
interface TraceStep {
  type: 'llm_call' | 'tool_call' | 'tool_result' | 'thought' | 'output';
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
```

### TestCase

```typescript
interface TestCase {
  name: string;
  id?: string;
  input: string;
  context?: Record<string, any>;
  trace?: string;
  agent?: AgentConfig;
  fixture?: string;
  mocks?: Record<string, any>;
  faults?: Record<string, FaultSpec>;
  tags?: string[];
  each?: Array<Record<string, any>>;
  retries?: number;
  retry_delay_ms?: number;
  depends_on?: string | string[];
  template?: string;
  template_params?: Record<string, any>;
  timeout_ms?: number;
  expect: Expectations;
}
```

### SuiteResult

```typescript
interface SuiteResult {
  name: string;
  passed: number;
  failed: number;
  total: number;
  duration_ms: number;
  results: TestResult[];
}
```

### TestResult

```typescript
interface TestResult {
  name: string;
  passed: boolean;
  assertions: AssertionResult[];
  duration_ms: number;
  trace?: AgentTrace;
  error?: string;
  tags?: string[];
  skipped?: boolean;
  skipReason?: string;
  attempts?: number;
}
```
