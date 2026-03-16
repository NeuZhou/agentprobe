// ===== Message types =====

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

// ===== Trace types =====

export interface AgentTrace {
  id: string;
  timestamp: string;
  steps: TraceStep[];
  metadata: Record<string, any>;
}

export type StepType = 'llm_call' | 'tool_call' | 'tool_result' | 'thought' | 'output';

export interface TraceStep {
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

// ===== Test types =====

export interface TestConfig {
  timeout_ms?: number;
  parallel?: boolean;
  env?: Record<string, string>;
}

export interface TestSuite {
  name: string;
  description?: string;
  config?: TestConfig;
  tests: TestCase[];
}

export interface TestCase {
  name: string;
  input: string;
  context?: Record<string, any>;
  trace?: string;
  expect: Expectations;
}

export interface Expectations {
  tool_called?: string | string[];
  tool_not_called?: string | string[];
  output_contains?: string | string[];
  output_not_contains?: string | string[];
  output_matches?: string;
  max_steps?: number;
  max_tokens?: number;
  max_duration_ms?: number;
  tool_args_match?: Record<string, any>;
  tool_sequence?: string[];
  custom?: string;
}

// ===== Result types =====

export interface AssertionResult {
  name: string;
  passed: boolean;
  expected?: any;
  actual?: any;
  message?: string;
}

export interface TestResult {
  name: string;
  passed: boolean;
  assertions: AssertionResult[];
  duration_ms: number;
  trace?: AgentTrace;
  error?: string;
}

export interface SuiteResult {
  name: string;
  passed: number;
  failed: number;
  total: number;
  duration_ms: number;
  results: TestResult[];
}

export type ReportFormat = 'console' | 'json' | 'markdown';
