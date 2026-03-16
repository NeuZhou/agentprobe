/**
 * MCP Server Testing - First-class support for testing MCP (Model Context Protocol) servers.
 *
 * Supports both stdio-based and HTTP-based MCP servers with tool invocation,
 * tool listing, error handling, and response time assertions.
 */

import type { AssertionResult } from './types';

// ===== Types =====

export interface MCPServerConfig {
  /** Stdio-based: command to spawn the server */
  command?: string;
  /** Stdio-based: arguments */
  args?: string[];
  /** HTTP-based: URL of the MCP server */
  url?: string;
  /** Environment variables for stdio server */
  env?: Record<string, string>;
  /** Startup timeout in ms */
  startup_timeout_ms?: number;
}

export interface MCPExpectations {
  /** Expected substring in tool output */
  output_contains?: string | string[];
  /** Output must not contain */
  output_not_contains?: string | string[];
  /** Expected error substring */
  error_contains?: string;
  /** Response time constraint */
  response_time_ms?: { lt?: number; gt?: number };
  /** Tools that should be listed */
  tools_include?: string[];
  /** Tools that should NOT be listed */
  tools_exclude?: string[];
  /** Exact tool count */
  tool_count?: number;
  /** Output matches regex */
  output_matches?: string;
}

export interface MCPTestCase {
  name: string;
  /** Tool to invoke */
  tool?: string;
  /** Input arguments for the tool */
  input?: Record<string, any>;
  /** Action instead of tool call */
  action?: 'list_tools' | 'ping' | 'initialize';
  /** Expected results */
  expect: MCPExpectations;
  /** Per-test timeout */
  timeout_ms?: number;
  tags?: string[];
}

export interface MCPTestSuite {
  adapter: 'mcp';
  mcp_server: MCPServerConfig;
  tests: MCPTestCase[];
  tags?: string[];
}

export interface MCPToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, any>;
}

export interface MCPToolResult {
  content: string;
  error?: string;
  duration_ms: number;
}

export interface MCPTestResult {
  name: string;
  passed: boolean;
  assertions: AssertionResult[];
  duration_ms: number;
  error?: string;
  tags?: string[];
}

export interface MCPSuiteResult {
  passed: number;
  failed: number;
  total: number;
  duration_ms: number;
  results: MCPTestResult[];
}

// ===== Evaluation =====

/**
 * Evaluate MCP expectations against a tool result.
 */
export function evaluateMCPExpectations(
  result: MCPToolResult,
  expect: MCPExpectations,
  listedTools?: MCPToolInfo[],
): AssertionResult[] {
  const assertions: AssertionResult[] = [];

  // output_contains
  if (expect.output_contains) {
    const expected = Array.isArray(expect.output_contains)
      ? expect.output_contains
      : [expect.output_contains];
    for (const needle of expected) {
      assertions.push({
        name: `output_contains: "${needle}"`,
        passed: result.content.includes(needle),
        expected: needle,
        actual: result.content.substring(0, 200),
        message: result.content.includes(needle)
          ? undefined
          : `Output does not contain "${needle}"`,
      });
    }
  }

  // output_not_contains
  if (expect.output_not_contains) {
    const notExpected = Array.isArray(expect.output_not_contains)
      ? expect.output_not_contains
      : [expect.output_not_contains];
    for (const needle of notExpected) {
      assertions.push({
        name: `output_not_contains: "${needle}"`,
        passed: !result.content.includes(needle),
        expected: `not "${needle}"`,
        actual: result.content.substring(0, 200),
        message: result.content.includes(needle)
          ? `Output should not contain "${needle}"`
          : undefined,
      });
    }
  }

  // error_contains
  if (expect.error_contains) {
    const err = result.error ?? '';
    assertions.push({
      name: `error_contains: "${expect.error_contains}"`,
      passed: err.includes(expect.error_contains),
      expected: expect.error_contains,
      actual: err || '(no error)',
      message: err.includes(expect.error_contains)
        ? undefined
        : `Error does not contain "${expect.error_contains}"`,
    });
  }

  // response_time_ms
  if (expect.response_time_ms) {
    if (expect.response_time_ms.lt !== undefined) {
      assertions.push({
        name: `response_time < ${expect.response_time_ms.lt}ms`,
        passed: result.duration_ms < expect.response_time_ms.lt,
        expected: `< ${expect.response_time_ms.lt}ms`,
        actual: `${result.duration_ms}ms`,
        message: result.duration_ms < expect.response_time_ms.lt
          ? undefined
          : `Response took ${result.duration_ms}ms, expected < ${expect.response_time_ms.lt}ms`,
      });
    }
    if (expect.response_time_ms.gt !== undefined) {
      assertions.push({
        name: `response_time > ${expect.response_time_ms.gt}ms`,
        passed: result.duration_ms > expect.response_time_ms.gt,
        expected: `> ${expect.response_time_ms.gt}ms`,
        actual: `${result.duration_ms}ms`,
      });
    }
  }

  // output_matches
  if (expect.output_matches) {
    const re = new RegExp(expect.output_matches);
    assertions.push({
      name: `output_matches: ${expect.output_matches}`,
      passed: re.test(result.content),
      expected: expect.output_matches,
      actual: result.content.substring(0, 200),
    });
  }

  // tools_include
  if (expect.tools_include && listedTools) {
    const toolNames = listedTools.map(t => t.name);
    for (const tool of expect.tools_include) {
      assertions.push({
        name: `tools_include: ${tool}`,
        passed: toolNames.includes(tool),
        expected: tool,
        actual: toolNames,
        message: toolNames.includes(tool)
          ? undefined
          : `Tool "${tool}" not found in listed tools`,
      });
    }
  }

  // tools_exclude
  if (expect.tools_exclude && listedTools) {
    const toolNames = listedTools.map(t => t.name);
    for (const tool of expect.tools_exclude) {
      assertions.push({
        name: `tools_exclude: ${tool}`,
        passed: !toolNames.includes(tool),
        expected: `not "${tool}"`,
        actual: toolNames,
      });
    }
  }

  // tool_count
  if (expect.tool_count !== undefined && listedTools) {
    assertions.push({
      name: `tool_count: ${expect.tool_count}`,
      passed: listedTools.length === expect.tool_count,
      expected: expect.tool_count,
      actual: listedTools.length,
    });
  }

  return assertions;
}

/**
 * Validate an MCP test suite configuration.
 */
export function validateMCPSuite(suite: MCPTestSuite): string[] {
  const errors: string[] = [];

  if (!suite.mcp_server) {
    errors.push('mcp_server configuration is required');
  } else if (!suite.mcp_server.command && !suite.mcp_server.url) {
    errors.push('mcp_server must have either "command" or "url"');
  }

  if (!suite.tests || suite.tests.length === 0) {
    errors.push('At least one test is required');
  }

  for (const test of suite.tests ?? []) {
    if (!test.name) {
      errors.push('Each test must have a "name"');
    }
    if (!test.tool && !test.action) {
      errors.push(`Test "${test.name}": must specify either "tool" or "action"`);
    }
    if (test.tool && test.action) {
      errors.push(`Test "${test.name}": cannot specify both "tool" and "action"`);
    }
  }

  return errors;
}

/**
 * Build a mock MCP tool result for testing purposes.
 */
export function buildMockMCPResult(content: string, opts?: {
  error?: string;
  duration_ms?: number;
}): MCPToolResult {
  return {
    content,
    error: opts?.error,
    duration_ms: opts?.duration_ms ?? 50,
  };
}

/**
 * Format MCP test results for console display.
 */
export function formatMCPResults(results: MCPSuiteResult): string {
  const lines: string[] = [];
  lines.push(`\nMCP Server Test Results`);
  lines.push(`${'='.repeat(40)}`);

  for (const r of results.results) {
    const icon = r.passed ? '✅' : '❌';
    lines.push(`${icon} ${r.name} (${r.duration_ms}ms)`);
    for (const a of r.assertions) {
      if (!a.passed) {
        lines.push(`   ❌ ${a.name}: ${a.message ?? 'failed'}`);
      }
    }
    if (r.error) {
      lines.push(`   ⚠️ Error: ${r.error}`);
    }
  }

  lines.push(`\n${results.passed}/${results.total} passed, ${results.failed} failed (${results.duration_ms}ms)`);
  return lines.join('\n');
}

/**
 * Run MCP test suite against provided tool/action handlers.
 * This is the evaluation-only version - actual server spawning is done by adapters.
 */
export function evaluateMCPSuite(
  suite: MCPTestSuite,
  toolResults: Map<string, MCPToolResult>,
  listedTools?: MCPToolInfo[],
): MCPSuiteResult {
  const start = Date.now();
  const results: MCPTestResult[] = [];

  for (const test of suite.tests) {
    const testStart = Date.now();
    const key = test.tool ?? test.action ?? 'unknown';
    const result = toolResults.get(test.name) ?? toolResults.get(key);

    if (!result && !test.action) {
      results.push({
        name: test.name,
        passed: false,
        assertions: [],
        duration_ms: Date.now() - testStart,
        error: `No result found for test "${test.name}"`,
        tags: test.tags,
      });
      continue;
    }

    const mockResult = result ?? buildMockMCPResult('', { duration_ms: 0 });
    const assertions = evaluateMCPExpectations(
      mockResult,
      test.expect,
      test.action === 'list_tools' ? listedTools : undefined,
    );
    const passed = assertions.every(a => a.passed);

    results.push({
      name: test.name,
      passed,
      assertions,
      duration_ms: Date.now() - testStart,
      tags: test.tags,
    });
  }

  return {
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    total: results.length,
    duration_ms: Date.now() - start,
    results,
  };
}
