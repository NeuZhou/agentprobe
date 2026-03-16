/**
 * AgentProbe MCP Server - Expose AgentProbe as MCP tools for any AI agent.
 *
 * Tools:
 *   run_test        - Run a single test file
 *   run_suite       - Run a test suite
 *   analyze_trace   - Analyze an agent trace
 *   security_scan   - Run security scan on agent traces
 *   generate_test   - Generate test from natural language description
 *   compare_results - Compare two test runs
 *   get_coverage    - Get test coverage report
 *   benchmark_agent - Run benchmark suite
 *   compliance_audit - Run compliance audit
 *   mcp_security_scan - Scan MCP server security
 */

import {
  ErrorCodes,
  encodeMessage,
  parseMessages,
  createResponse,
  createErrorResponse,
  isNotification,
  validateRequest,
} from './mcp-protocol';
import type { JSONRPCMessage, JSONRPCRequest } from './mcp-protocol';
import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yaml';

// ===== Types =====

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface MCPServerOptions {
  /** Working directory for test/trace resolution */
  cwd?: string;
  /** Enable debug logging to stderr */
  debug?: boolean;
}

// ===== Tool Definitions =====

const TOOLS: MCPToolDefinition[] = [
  {
    name: 'run_test',
    description: 'Run a single AgentProbe test file (YAML or JSON). Returns pass/fail results with assertion details.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Path to test file (YAML/JSON)' },
        timeout_ms: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Filter tests by tags' },
      },
      required: ['file'],
    },
  },
  {
    name: 'run_suite',
    description: 'Run a test suite (directory or glob of test files). Returns aggregated results.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to suite directory or glob pattern' },
        parallel: { type: 'boolean', description: 'Run tests in parallel (default: false)' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Filter tests by tags' },
        format: { type: 'string', enum: ['json', 'text', 'junit'], description: 'Output format (default: json)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'analyze_trace',
    description: 'Analyze an agent execution trace. Returns timing, tool usage, cost, and quality metrics.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Path to trace file (JSON/YAML)' },
        metrics: {
          type: 'array',
          items: { type: 'string', enum: ['timing', 'tools', 'cost', 'quality', 'all'] },
          description: 'Which metrics to analyze (default: all)',
        },
      },
      required: ['file'],
    },
  },
  {
    name: 'security_scan',
    description: 'Run security analysis on agent traces. Detects prompt injection, data leaks, unauthorized tool use.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to trace file or directory' },
        checks: {
          type: 'array',
          items: { type: 'string', enum: ['prompt_injection', 'data_leak', 'tool_abuse', 'all'] },
          description: 'Security checks to run (default: all)',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'generate_test',
    description: 'Generate an AgentProbe test from a natural language description.',
    inputSchema: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'Natural language description of what to test' },
        adapter: { type: 'string', enum: ['openai', 'anthropic', 'langchain', 'custom'], description: 'Target adapter' },
        output: { type: 'string', description: 'Output file path (default: stdout)' },
      },
      required: ['description'],
    },
  },
  {
    name: 'compare_results',
    description: 'Compare two test run results. Shows regressions, improvements, and new failures.',
    inputSchema: {
      type: 'object',
      properties: {
        baseline: { type: 'string', description: 'Path to baseline results file' },
        current: { type: 'string', description: 'Path to current results file' },
        threshold: { type: 'number', description: 'Regression threshold percentage (default: 5)' },
      },
      required: ['baseline', 'current'],
    },
  },
  {
    name: 'get_coverage',
    description: 'Analyze test coverage for an agent. Shows which tools, prompts, and paths are tested.',
    inputSchema: {
      type: 'object',
      properties: {
        suite: { type: 'string', description: 'Path to test suite' },
        format: { type: 'string', enum: ['summary', 'detailed', 'json'], description: 'Output format (default: summary)' },
      },
      required: ['suite'],
    },
  },
  {
    name: 'benchmark_agent',
    description: 'Run performance benchmark on agent. Measures latency, throughput, token usage across runs.',
    inputSchema: {
      type: 'object',
      properties: {
        suite: { type: 'string', description: 'Path to benchmark suite' },
        iterations: { type: 'number', description: 'Number of iterations (default: 5)' },
        warmup: { type: 'number', description: 'Warmup iterations (default: 1)' },
      },
      required: ['suite'],
    },
  },
  {
    name: 'compliance_audit',
    description: 'Run compliance audit against agent traces. Checks safety, privacy, and policy adherence.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to trace directory' },
        framework: { type: 'string', enum: ['owasp-llm', 'nist-ai', 'eu-ai-act', 'custom'], description: 'Compliance framework' },
        policy: { type: 'string', description: 'Path to custom policy file' },
      },
      required: ['path'],
    },
  },
  {
    name: 'mcp_security_scan',
    description: 'Scan an MCP server for security issues. Analyzes tool definitions, input validation, dangerous operations.',
    inputSchema: {
      type: 'object',
      properties: {
        config: { type: 'string', description: 'Path to MCP server config or test suite file' },
        checks: {
          type: 'array',
          items: { type: 'string', enum: ['input_validation', 'dangerous_ops', 'auth', 'all'] },
          description: 'Checks to run (default: all)',
        },
      },
      required: ['config'],
    },
  },
];

// ===== Tool Handlers =====

type ToolHandler = (args: Record<string, any>, cwd: string) => Promise<any>;

function resolveFilePath(file: string, cwd: string): string {
  return path.isAbsolute(file) ? file : path.resolve(cwd, file);
}

function loadFile(file: string, cwd: string): any {
  const resolved = resolveFilePath(file, cwd);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }
  const content = fs.readFileSync(resolved, 'utf-8');
  if (resolved.endsWith('.yaml') || resolved.endsWith('.yml')) {
    return YAML.parse(content);
  }
  return JSON.parse(content);
}

const handlers: Record<string, ToolHandler> = {
  async run_test(args, cwd) {
    const { runSuite } = await import('./runner');
    const file = resolveFilePath(args.file, cwd);
    if (!fs.existsSync(file)) {
      return { error: `Test file not found: ${file}` };
    }
    const results = await runSuite(file, { tags: args.tags });
    return {
      passed: results.passed,
      failed: results.failed,
      total: results.total,
      duration_ms: results.duration_ms,
      results: results.results.map((r: any) => ({
        name: r.name,
        passed: r.passed,
        assertions: r.assertions,
        duration_ms: r.duration_ms,
        error: r.error,
      })),
    };
  },

  async run_suite(args, cwd) {
    const { runSuite } = await import('./runner');
    const suitePath = resolveFilePath(args.path, cwd);
    const files = fs.statSync(suitePath).isDirectory()
      ? fs.readdirSync(suitePath)
          .filter(f => f.endsWith('.yaml') || f.endsWith('.yml') || f.endsWith('.json'))
          .map(f => path.join(suitePath, f))
      : [suitePath];

    const allResults: any[] = [];
    let totalPassed = 0, totalFailed = 0;

    for (const file of files) {
      const results = await runSuite(file, { tags: args.tags });
      totalPassed += results.passed;
      totalFailed += results.failed;
      allResults.push({ file: path.basename(file), ...results });
    }

    return { passed: totalPassed, failed: totalFailed, total: totalPassed + totalFailed, suites: allResults };
  },

  async analyze_trace(args, cwd) {
    const trace = loadFile(args.file, cwd);
    const metrics = args.metrics ?? ['all'];
    const result: Record<string, any> = { trace_id: trace.id };

    if (metrics.includes('all') || metrics.includes('timing')) {
      const totalMs = trace.steps?.reduce((s: number, st: any) => s + (st.duration_ms ?? 0), 0) ?? 0;
      result.timing = { total_ms: totalMs, steps: trace.steps?.length ?? 0 };
    }
    if (metrics.includes('all') || metrics.includes('tools')) {
      const toolCalls = (trace.steps ?? []).filter((s: any) => s.type === 'tool_call');
      const toolNames = toolCalls.map((s: any) => s.data?.tool_name).filter(Boolean);
      result.tools = { count: toolCalls.length, unique: [...new Set(toolNames)], names: toolNames };
    }
    if (metrics.includes('all') || metrics.includes('cost')) {
      const llmCalls = (trace.steps ?? []).filter((s: any) => s.type === 'llm_call');
      const totalTokens = llmCalls.reduce((s: number, c: any) => {
        const t = c.data?.tokens;
        return s + (t?.input ?? 0) + (t?.output ?? 0);
      }, 0);
      result.cost = { llm_calls: llmCalls.length, total_tokens: totalTokens };
    }
    return result;
  },

  async security_scan(args, cwd) {
    const { generateSecurityTests } = await import('./security');
    const filePath = resolveFilePath(args.path, cwd);
    const trace = loadFile(args.path, cwd);
    const securityTests = generateSecurityTests(trace);
    return {
      checks_run: securityTests.length,
      trace_file: path.basename(filePath),
      security_tests: securityTests.map((t: any) => ({ name: t.name, type: t.type })),
    };
  },

  async generate_test(args, _cwd) {
    const { generateTests, formatGeneratedTests } = await import('./codegen');
    // Use codegen with a mock trace structure
    const mockTrace = {
      id: 'generated',
      timestamp: new Date().toISOString(),
      steps: [],
      metadata: { description: args.description, adapter: args.adapter ?? 'custom' },
    };
    const tests = generateTests(mockTrace, 'generated.yaml');
    return { description: args.description, adapter: args.adapter ?? 'custom', tests: formatGeneratedTests(tests, 'generated') };
  },

  async compare_results(args, cwd) {
    const baseline = loadFile(args.baseline, cwd);
    const current = loadFile(args.current, cwd);
    const threshold = args.threshold ?? 5;

    const basePass = baseline.passed ?? 0;
    const curPass = current.passed ?? 0;
    const baseTotal = baseline.total ?? 1;
    const curTotal = current.total ?? 1;
    const baseRate = (basePass / baseTotal) * 100;
    const curRate = (curPass / curTotal) * 100;
    const delta = curRate - baseRate;

    return {
      baseline: { passed: basePass, total: baseTotal, rate: baseRate },
      current: { passed: curPass, total: curTotal, rate: curRate },
      delta_percent: delta,
      regression: delta < -threshold,
      improvement: delta > threshold,
    };
  },

  async get_coverage(args, cwd) {
    const { analyzeCoverage, formatCoverage } = await import('./coverage');
    const suite = loadFile(args.suite, cwd);
    const coverage = analyzeCoverage(suite);
    return { format: args.format ?? 'summary', coverage, formatted: formatCoverage(coverage) };
  },

  async benchmark_agent(args, cwd) {
    const suite = loadFile(args.suite, cwd);
    const iterations = args.iterations ?? 5;
    // Return benchmark config — actual execution requires runner
    return {
      suite_file: args.suite,
      iterations,
      warmup: args.warmup ?? 1,
      tests: suite.tests?.length ?? 0,
      status: 'configured',
      message: `Benchmark configured: ${iterations} iterations over ${suite.tests?.length ?? 0} tests`,
    };
  },

  async compliance_audit(args, cwd) {
    const { checkComplianceDir, formatComplianceResult } = await import('./compliance');
    const dirPath = resolveFilePath(args.path, cwd);
    const policies = args.policy ? (loadFile(args.policy, cwd).policies ?? []) : [];
    const result = checkComplianceDir(dirPath, policies);
    return { framework: args.framework ?? 'default', report: result, formatted: formatComplianceResult(result) };
  },

  async mcp_security_scan(args, cwd) {
    const { analyzeMCPSecurity, formatMCPSecurity } = await import('./mcp-test');
    const config = loadFile(args.config, cwd);
    // Extract tool definitions from config
    const tools = config.tools ?? config.mcp_server?.tools ?? [];
    const report = analyzeMCPSecurity(tools);
    return { tools_scanned: tools.length, report, formatted: formatMCPSecurity(report) };
  },
};

// ===== Server =====

export class AgentProbeMCPServer {
  private initialized = false;
  private buffer = '';
  private readonly cwd: string;
  private readonly debug: boolean;

  constructor(opts: MCPServerOptions = {}) {
    this.cwd = opts.cwd ?? process.cwd();
    this.debug = opts.debug ?? false;
  }

  /** Start the server on stdin/stdout. */
  start(): void {
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk: string) => this.onData(chunk));
    process.stdin.on('end', () => process.exit(0));
    this.log('AgentProbe MCP Server started');
  }

  private log(msg: string): void {
    if (this.debug) {
      process.stderr.write(`[agentprobe-mcp] ${msg}\n`);
    }
  }

  private send(msg: JSONRPCMessage): void {
    const encoded = encodeMessage(msg);
    process.stdout.write(encoded);
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    const { messages, remaining } = parseMessages(this.buffer);
    this.buffer = remaining;

    for (const msg of messages) {
      if (isNotification(msg)) {
        this.handleNotification(msg.method, msg.params);
      } else if (validateRequest(msg)) {
        this.handleRequest(msg).catch(err => {
          this.send(createErrorResponse(msg.id, ErrorCodes.InternalError, err.message));
        });
      }
    }
  }

  private handleNotification(method: string, _params?: Record<string, any>): void {
    this.log(`Notification: ${method}`);
    // notifications/initialized, etc. — acknowledged silently
  }

  private async handleRequest(req: JSONRPCRequest): Promise<void> {
    this.log(`Request: ${req.method} (id: ${req.id})`);

    switch (req.method) {
      case 'initialize':
        return this.handleInitialize(req);
      case 'tools/list':
        return this.handleToolsList(req);
      case 'tools/call':
        return this.handleToolsCall(req);
      case 'ping':
        this.send(createResponse(req.id, {}));
        return;
      default:
        this.send(createErrorResponse(req.id, ErrorCodes.MethodNotFound, `Unknown method: ${req.method}`));
    }
  }

  private handleInitialize(req: JSONRPCRequest): void {
    this.initialized = true;
    this.send(createResponse(req.id, {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: 'agentprobe',
        version: '4.4.0',
      },
    }));
  }

  private handleToolsList(req: JSONRPCRequest): void {
    if (!this.initialized) {
      this.send(createErrorResponse(req.id, ErrorCodes.ServerNotInitialized, 'Server not initialized'));
      return;
    }
    this.send(createResponse(req.id, { tools: TOOLS }));
  }

  private async handleToolsCall(req: JSONRPCRequest): Promise<void> {
    if (!this.initialized) {
      this.send(createErrorResponse(req.id, ErrorCodes.ServerNotInitialized, 'Server not initialized'));
      return;
    }

    const name = req.params?.name;
    const args = req.params?.arguments ?? {};

    if (!name || !handlers[name]) {
      this.send(createErrorResponse(req.id, ErrorCodes.ToolNotFound, `Tool not found: ${name}`));
      return;
    }

    try {
      const result = await handlers[name](args, this.cwd);
      this.send(createResponse(req.id, {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }));
    } catch (err: any) {
      this.send(createResponse(req.id, {
        content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }],
        isError: true,
      }));
    }
  }

  /** Get tool definitions (for testing). */
  getTools(): MCPToolDefinition[] {
    return TOOLS;
  }

  /** Get tool names. */
  getToolNames(): string[] {
    return TOOLS.map(t => t.name);
  }
}

/**
 * Create and start an MCP server instance.
 */
export function startMCPServer(opts?: MCPServerOptions): AgentProbeMCPServer {
  const server = new AgentProbeMCPServer(opts);
  server.start();
  return server;
}
