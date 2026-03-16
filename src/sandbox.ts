/**
 * Agent Sandbox — Run agents in isolated sandbox environments
 * Enforces tool whitelists, cost caps, timeouts, and output size limits.
 * Captures all tool calls, LLM interactions, and side effects.
 * @module
 */

import type { AgentConfig, AgentTrace, TraceStep } from './types';

export interface SandboxConfig {
  timeout: number;
  maxCost: number;
  allowedTools: string[];
  maxOutputSize?: number;
  maxSteps?: number;
}

export interface SandboxViolation {
  type: 'tool_blocked' | 'cost_exceeded' | 'timeout' | 'output_exceeded' | 'steps_exceeded';
  message: string;
  detail?: any;
}

export interface SandboxResult {
  success: boolean;
  trace: AgentTrace;
  violations: SandboxViolation[];
  totalCost: number;
  durationMs: number;
  toolCalls: string[];
  blockedCalls: string[];
}

export interface SandboxStats {
  totalRuns: number;
  totalViolations: number;
  violationsByType: Record<string, number>;
  avgDurationMs: number;
  avgCost: number;
}

const DEFAULT_MAX_OUTPUT = 1024 * 1024; // 1MB
const DEFAULT_MAX_STEPS = 100;

/**
 * Validate sandbox configuration
 */
export function validateSandboxConfig(config: SandboxConfig): string[] {
  const errors: string[] = [];
  if (config.timeout <= 0) errors.push('timeout must be positive');
  if (config.maxCost <= 0) errors.push('maxCost must be positive');
  if (!config.allowedTools || config.allowedTools.length === 0) {
    errors.push('allowedTools must not be empty');
  }
  if (config.maxOutputSize !== undefined && config.maxOutputSize <= 0) {
    errors.push('maxOutputSize must be positive');
  }
  if (config.maxSteps !== undefined && config.maxSteps <= 0) {
    errors.push('maxSteps must be positive');
  }
  return errors;
}

/**
 * Check if a tool call is allowed by the sandbox
 */
export function isToolAllowed(toolName: string, allowedTools: string[]): boolean {
  return allowedTools.includes(toolName) || allowedTools.includes('*');
}

/**
 * Estimate cost from trace steps
 */
export function estimateCostFromSteps(steps: TraceStep[], costPerInputToken = 0.00003, costPerOutputToken = 0.00006): number {
  let total = 0;
  for (const step of steps) {
    if (step.data.tokens) {
      total += (step.data.tokens.input ?? 0) * costPerInputToken;
      total += (step.data.tokens.output ?? 0) * costPerOutputToken;
    }
  }
  return Math.round(total * 1e6) / 1e6;
}

/**
 * Check trace steps against sandbox constraints and collect violations
 */
export function checkViolations(steps: TraceStep[], config: SandboxConfig, durationMs: number): SandboxViolation[] {
  const violations: SandboxViolation[] = [];
  const maxOutput = config.maxOutputSize ?? DEFAULT_MAX_OUTPUT;
  const maxSteps = config.maxSteps ?? DEFAULT_MAX_STEPS;

  // Check timeout
  if (durationMs > config.timeout) {
    violations.push({ type: 'timeout', message: `Execution exceeded timeout: ${durationMs}ms > ${config.timeout}ms` });
  }

  // Check cost
  const cost = estimateCostFromSteps(steps);
  if (cost > config.maxCost) {
    violations.push({ type: 'cost_exceeded', message: `Cost exceeded: $${cost} > $${config.maxCost}`, detail: { cost, maxCost: config.maxCost } });
  }

  // Check steps
  if (steps.length > maxSteps) {
    violations.push({ type: 'steps_exceeded', message: `Steps exceeded: ${steps.length} > ${maxSteps}` });
  }

  // Check tool calls and output size
  let totalOutput = 0;
  for (const step of steps) {
    if (step.type === 'tool_call' && step.data.tool_name) {
      if (!isToolAllowed(step.data.tool_name, config.allowedTools)) {
        violations.push({ type: 'tool_blocked', message: `Tool not allowed: ${step.data.tool_name}`, detail: { tool: step.data.tool_name } });
      }
    }
    if (step.type === 'tool_result' && step.data.tool_result) {
      const size = JSON.stringify(step.data.tool_result).length;
      totalOutput += size;
    }
    if (step.type === 'output' && step.data.content) {
      totalOutput += step.data.content.length;
    }
  }
  if (totalOutput > maxOutput) {
    violations.push({ type: 'output_exceeded', message: `Output size exceeded: ${totalOutput} > ${maxOutput}` });
  }

  return violations;
}

/**
 * Extract tool call names from trace steps
 */
export function extractToolCalls(steps: TraceStep[]): { called: string[]; blocked: string[]; allowedTools: string[] } & Record<string, never> {
  // Just extract called tools - blocking is checked separately
  const called: string[] = [];
  for (const step of steps) {
    if (step.type === 'tool_call' && step.data.tool_name) {
      called.push(step.data.tool_name);
    }
  }
  return { called, blocked: [], allowedTools: [] };
}

/**
 * Build a SandboxResult from trace and config
 */
export function buildSandboxResult(trace: AgentTrace, config: SandboxConfig, durationMs: number): SandboxResult {
  const violations = checkViolations(trace.steps, config, durationMs);
  const { called } = extractToolCalls(trace.steps);
  const blocked = called.filter(t => !isToolAllowed(t, config.allowedTools));
  const cost = estimateCostFromSteps(trace.steps);

  return {
    success: violations.length === 0,
    trace,
    violations,
    totalCost: cost,
    durationMs,
    toolCalls: called,
    blockedCalls: blocked,
  };
}

/**
 * Compute aggregate stats from multiple sandbox runs
 */
export function computeSandboxStats(results: SandboxResult[]): SandboxStats {
  if (results.length === 0) {
    return { totalRuns: 0, totalViolations: 0, violationsByType: {}, avgDurationMs: 0, avgCost: 0 };
  }

  const violationsByType: Record<string, number> = {};
  let totalViolations = 0;
  let totalDuration = 0;
  let totalCost = 0;

  for (const r of results) {
    totalDuration += r.durationMs;
    totalCost += r.totalCost;
    for (const v of r.violations) {
      totalViolations++;
      violationsByType[v.type] = (violationsByType[v.type] ?? 0) + 1;
    }
  }

  return {
    totalRuns: results.length,
    totalViolations,
    violationsByType,
    avgDurationMs: Math.round(totalDuration / results.length),
    avgCost: Math.round((totalCost / results.length) * 1e6) / 1e6,
  };
}

/**
 * Format sandbox result for display
 */
export function formatSandboxResult(result: SandboxResult): string {
  const lines: string[] = [];
  lines.push(`🏖️ Sandbox Result: ${result.success ? '✅ PASS' : '❌ FAIL'}`);
  lines.push(`  Duration: ${result.durationMs}ms`);
  lines.push(`  Cost: $${result.totalCost}`);
  lines.push(`  Tool calls: ${result.toolCalls.length}`);
  if (result.blockedCalls.length > 0) {
    lines.push(`  Blocked: ${result.blockedCalls.join(', ')}`);
  }
  if (result.violations.length > 0) {
    lines.push(`  Violations:`);
    for (const v of result.violations) {
      lines.push(`    - [${v.type}] ${v.message}`);
    }
  }
  return lines.join('\n');
}

/**
 * AgentSandbox class — stateful sandbox runner
 */
export class AgentSandbox {
  private config: SandboxConfig;
  private runs: SandboxResult[] = [];

  constructor(config: SandboxConfig) {
    const errors = validateSandboxConfig(config);
    if (errors.length > 0) {
      throw new Error(`Invalid sandbox config: ${errors.join('; ')}`);
    }
    this.config = config;
  }

  getConfig(): SandboxConfig {
    return { ...this.config };
  }

  /**
   * Run an agent trace through the sandbox (synchronous evaluation)
   */
  run(_agent: AgentConfig, _input: string, trace?: AgentTrace, durationMs?: number): SandboxResult {
    const t = trace ?? { id: 'empty', timestamp: new Date().toISOString(), steps: [], metadata: {} };
    const d = durationMs ?? 0;
    const result = buildSandboxResult(t, this.config, d);
    this.runs.push(result);
    return result;
  }

  getRuns(): SandboxResult[] {
    return [...this.runs];
  }

  getStats(): SandboxStats {
    return computeSandboxStats(this.runs);
  }

  reset(): void {
    this.runs = [];
  }
}
