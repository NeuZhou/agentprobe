/**
 * AgentProbe SDK — Clean programmatic API for using AgentProbe as a library.
 *
 * @example
 * ```typescript
 * import { AgentProbe } from '@neuzhou/agentprobe';
 *
 * const probe = new AgentProbe({ adapter: 'openai', model: 'gpt-4' });
 * const trace = await probe.record('What is the weather?');
 * const result = await probe.test(trace, { tool_called: 'get_weather' });
 * const results = await probe.runSuite('tests.yaml');
 * const diff = await probe.diff(trace1, trace2);
 * ```
 */

import { Recorder, loadTrace } from './recorder';
import { evaluate } from './assertions';
import { runSuite as runSuiteInternal } from './runner';
import { diffTraces, formatDiff } from './diff';
import type {
  AgentTrace,
  Expectations,
  AssertionResult,
  SuiteResult,
} from './types';
import type { TraceDiff } from './diff';

// ===== SDK Types =====

export type AdapterType = 'openai' | 'anthropic' | 'gemini' | 'azure-openai' | 'ollama' | 'custom';

export interface AgentProbeOptions {
  /** LLM provider adapter */
  adapter?: AdapterType;
  /** Model name (e.g. 'gpt-4', 'claude-3-opus') */
  model?: string;
  /** API key (defaults to env vars) */
  apiKey?: string;
  /** Base URL for API */
  baseUrl?: string;
  /** Default timeout per test in ms */
  timeoutMs?: number;
  /** Maximum cost per test in USD */
  maxCostPerTest?: number;
  /** Maximum cost per suite run in USD */
  maxCostPerSuite?: number;
  /** Custom metadata attached to all traces */
  metadata?: Record<string, any>;
}

export interface TestOptions extends Expectations {
  /** Timeout override for this test */
  timeout_ms?: number;
}

export interface RecordOptions {
  /** Additional context/system prompt */
  systemPrompt?: string;
  /** Mock tool responses */
  mocks?: Record<string, any>;
  /** Maximum steps before stopping */
  maxSteps?: number;
}

export interface DiffResult {
  diff: TraceDiff;
  formatted: string;
  hasDrift: boolean;
}

export interface BatchTestResult {
  suiteResult: SuiteResult;
  passed: boolean;
  summary: string;
}

// ===== AgentProbe Class =====

export class AgentProbe {
  private options: AgentProbeOptions;

  constructor(options: AgentProbeOptions = {}) {
    this.options = {
      adapter: 'openai',
      timeoutMs: 30_000,
      ...options,
    };
  }

  /**
   * Get the configured adapter type.
   */
  get adapter(): AdapterType {
    return this.options.adapter ?? 'openai';
  }

  /**
   * Get the configured model name.
   */
  get model(): string | undefined {
    return this.options.model;
  }

  /**
   * Record an agent interaction and return the trace.
   * In non-live mode, creates a trace stub for the given input.
   */
  async record(input: string, options: RecordOptions = {}): Promise<AgentTrace> {
    const recorder = new Recorder({
      adapter: this.options.adapter,
      model: this.options.model,
      input,
      ...(this.options.metadata ?? {}),
    });

    // Add the user input as an LLM call step
    recorder.addStep({
      type: 'llm_call',
      data: {
        model: this.options.model,
        messages: [
          ...(options.systemPrompt
            ? [{ role: 'system' as const, content: options.systemPrompt }]
            : []),
          { role: 'user' as const, content: input },
        ],
      },
      duration_ms: 0,
    });

    return recorder.getTrace();
  }

  /**
   * Test a trace against expectations. Returns assertion results.
   */
  async test(trace: AgentTrace, expectations: TestOptions): Promise<{
    passed: boolean;
    assertions: AssertionResult[];
    duration_ms: number;
  }> {
    const start = Date.now();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { timeout_ms, ...expect } = expectations;
    const assertions = evaluate(trace, expect);
    const passed = assertions.every((a) => a.passed);
    return {
      passed,
      assertions,
      duration_ms: Date.now() - start,
    };
  }

  /**
   * Run a full test suite from a YAML file.
   */
  async runSuite(suitePath: string, options?: {
    tags?: string[];
    updateSnapshots?: boolean;
    coverage?: boolean;
    declaredTools?: string[];
  }): Promise<BatchTestResult> {
    const suiteResult = await runSuiteInternal(suitePath, options);
    const passed = suiteResult.failed === 0;
    const summary = `${suiteResult.passed}/${suiteResult.total} passed (${suiteResult.duration_ms}ms)`;
    return { suiteResult, passed, summary };
  }

  /**
   * Compare two traces and return structured diff.
   */
  async diff(oldTrace: AgentTrace, newTrace: AgentTrace): Promise<DiffResult> {
    const d = diffTraces(oldTrace, newTrace);
    return {
      diff: d,
      formatted: formatDiff(d),
      hasDrift: d.warnings.length > 0 || d.outputChanged,
    };
  }

  /**
   * Load a trace from a JSON file.
   */
  loadTrace(tracePath: string): AgentTrace {
    return loadTrace(tracePath);
  }

  /**
   * Create a new Recorder instance with SDK defaults.
   */
  createRecorder(metadata?: Record<string, any>): Recorder {
    return new Recorder({
      adapter: this.options.adapter,
      model: this.options.model,
      ...metadata,
    });
  }

  /**
   * Patch an LLM SDK for automatic recording.
   */
  patchAdapter(sdkModule: any): Recorder {
    const recorder = this.createRecorder();
    switch (this.options.adapter) {
      case 'openai':
        recorder.patchOpenAI(sdkModule);
        break;
      case 'anthropic':
        recorder.patchAnthropic(sdkModule);
        break;
      case 'gemini':
        recorder.patchGemini(sdkModule);
        break;
      case 'azure-openai':
        recorder.patchAzureOpenAI(sdkModule);
        break;
      case 'ollama':
        recorder.patchOllama();
        break;
      default:
        break;
    }
    return recorder;
  }
}
