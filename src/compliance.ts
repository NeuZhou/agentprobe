import type { AgentTrace } from './types';
import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yaml';

export interface ComplianceAssertion {
  output_not_matches?: string | string[];
  max_cost_usd?: number;
  max_tokens?: number;
  tool_allowlist?: string[];
  tool_denylist?: string[];
  max_steps?: number;
  output_not_contains?: string | string[];
}

export interface CompliancePolicy {
  name: string;
  description?: string;
  assertions: ComplianceAssertion;
}

export interface ComplianceConfig {
  policies: CompliancePolicy[];
}

export interface ComplianceViolation {
  policy: string;
  assertion: string;
  message: string;
  trace_id?: string;
  step_index?: number;
}

export interface ComplianceResult {
  passed: boolean;
  violations: ComplianceViolation[];
  traces_checked: number;
  policies_checked: number;
}

/**
 * Load compliance policies from a YAML file.
 */
export function loadComplianceConfig(filePath: string): ComplianceConfig {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return YAML.parse(raw) as ComplianceConfig;
}

/**
 * Check a single trace against all compliance policies.
 */
export function checkCompliance(trace: AgentTrace, policies: CompliancePolicy[]): ComplianceViolation[] {
  const violations: ComplianceViolation[] = [];

  // Collect all outputs from the trace
  const outputs = trace.steps
    .filter(s => s.type === 'output')
    .map(s => s.data.content ?? '');
  const fullOutput = outputs.join('\n');

  // Collect tool calls
  const toolsCalled = trace.steps
    .filter(s => s.type === 'tool_call')
    .map(s => s.data.tool_name ?? '');

  // Collect token counts
  const totalTokens = trace.steps
    .filter(s => s.data.tokens)
    .reduce((sum, s) => sum + (s.data.tokens?.input ?? 0) + (s.data.tokens?.output ?? 0), 0);

  // Estimate cost (simplified: $0.01 per 1K tokens)
  const estimatedCost = totalTokens * 0.00001;

  for (const policy of policies) {
    const a = policy.assertions;

    // output_not_matches
    if (a.output_not_matches) {
      const patterns = Array.isArray(a.output_not_matches) ? a.output_not_matches : [a.output_not_matches];
      for (const pattern of patterns) {
        const re = new RegExp(pattern, 'gi');
        if (re.test(fullOutput)) {
          violations.push({
            policy: policy.name,
            assertion: 'output_not_matches',
            message: `Output matches forbidden pattern: ${pattern}`,
            trace_id: trace.id,
          });
        }
      }
    }

    // output_not_contains
    if (a.output_not_contains) {
      const items = Array.isArray(a.output_not_contains) ? a.output_not_contains : [a.output_not_contains];
      for (const item of items) {
        if (fullOutput.toLowerCase().includes(item.toLowerCase())) {
          violations.push({
            policy: policy.name,
            assertion: 'output_not_contains',
            message: `Output contains forbidden text: "${item}"`,
            trace_id: trace.id,
          });
        }
      }
    }

    // max_cost_usd
    if (a.max_cost_usd !== undefined && estimatedCost > a.max_cost_usd) {
      violations.push({
        policy: policy.name,
        assertion: 'max_cost_usd',
        message: `Estimated cost $${estimatedCost.toFixed(4)} exceeds limit $${a.max_cost_usd}`,
        trace_id: trace.id,
      });
    }

    // max_tokens
    if (a.max_tokens !== undefined && totalTokens > a.max_tokens) {
      violations.push({
        policy: policy.name,
        assertion: 'max_tokens',
        message: `Total tokens ${totalTokens} exceeds limit ${a.max_tokens}`,
        trace_id: trace.id,
      });
    }

    // max_steps
    if (a.max_steps !== undefined && trace.steps.length > a.max_steps) {
      violations.push({
        policy: policy.name,
        assertion: 'max_steps',
        message: `Steps ${trace.steps.length} exceeds limit ${a.max_steps}`,
        trace_id: trace.id,
      });
    }

    // tool_allowlist
    if (a.tool_allowlist) {
      for (const tool of toolsCalled) {
        if (!a.tool_allowlist.includes(tool)) {
          violations.push({
            policy: policy.name,
            assertion: 'tool_allowlist',
            message: `Tool "${tool}" not in allowlist [${a.tool_allowlist.join(', ')}]`,
            trace_id: trace.id,
          });
        }
      }
    }

    // tool_denylist
    if (a.tool_denylist) {
      for (const tool of toolsCalled) {
        if (a.tool_denylist.includes(tool)) {
          violations.push({
            policy: policy.name,
            assertion: 'tool_denylist',
            message: `Tool "${tool}" is on the denylist`,
            trace_id: trace.id,
          });
        }
      }
    }
  }

  return violations;
}

/**
 * Check all traces in a directory against compliance policies.
 */
export function checkComplianceDir(traceDir: string, policies: CompliancePolicy[]): ComplianceResult {
  const { glob } = require('glob');
  const files: string[] = glob.sync(path.join(traceDir, '**/*.json').replace(/\\/g, '/'));

  const allViolations: ComplianceViolation[] = [];
  let tracesChecked = 0;

  for (const file of files) {
    try {
      const raw = fs.readFileSync(file, 'utf-8');
      const trace = JSON.parse(raw) as AgentTrace;
      if (!trace.id || !trace.steps) continue;
      tracesChecked++;
      allViolations.push(...checkCompliance(trace, policies));
    } catch {
      // Skip non-trace files
    }
  }

  return {
    passed: allViolations.length === 0,
    violations: allViolations,
    traces_checked: tracesChecked,
    policies_checked: policies.length,
  };
}

/**
 * Format compliance results for console output.
 */
export function formatComplianceResult(result: ComplianceResult): string {
  const lines: string[] = [];
  lines.push(`\n🔒 Compliance Check`);
  lines.push(`   Traces: ${result.traces_checked} | Policies: ${result.policies_checked}`);

  if (result.passed) {
    lines.push(`   ✅ All policies passed`);
  } else {
    lines.push(`   ❌ ${result.violations.length} violation(s) found\n`);
    for (const v of result.violations) {
      lines.push(`   ✗ [${v.policy}] ${v.assertion}: ${v.message}`);
      if (v.trace_id) lines.push(`     trace: ${v.trace_id}`);
    }
  }

  return lines.join('\n');
}
