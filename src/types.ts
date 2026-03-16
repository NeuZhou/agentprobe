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

export interface HookConfig {
  command: string;
}

export interface SuiteHooks {
  beforeAll?: HookConfig;
  afterAll?: HookConfig;
  beforeEach?: HookConfig;
  afterEach?: HookConfig;
}

export interface AgentConfig {
  script?: string;
  command?: string;
  module?: string;
  entry?: string;
}

export interface TestSuite {
  name: string;
  description?: string;
  config?: TestConfig;
  hooks?: SuiteHooks;
  tests: TestCase[];
}

export interface TestCase {
  name: string;
  input: string;
  context?: Record<string, any>;
  trace?: string;
  agent?: AgentConfig;
  fixture?: string;
  mocks?: Record<string, any>;
  tags?: string[];
  each?: Array<Record<string, any>>;
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
  snapshot?: boolean;
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
  tags?: string[];
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

// ===== Runner options =====

export interface RunOptions {
  updateSnapshots?: boolean;
  tags?: string[];
  coverage?: boolean;
  declaredTools?: string[];
}
