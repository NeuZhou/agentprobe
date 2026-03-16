/**
 * Agent Contract Testing — Define and verify agent behavioral contracts
 *
 * @example
 * ```yaml
 * contract:
 *   name: "customer-support-agent"
 *   version: "2.0"
 *   capabilities:
 *     - tool: search_knowledge_base
 *       required: true
 *   behaviors:
 *     - always_greets: true
 *     - max_response_time_ms: 10000
 *   safety:
 *     - no_pii_in_responses: true
 * ```
 */

import type { AgentTrace } from './types';

export interface CapabilitySpec {
  tool: string;
  required: boolean;
  max_amount?: number;
  max_calls?: number;
  args_schema?: Record<string, any>;
}

export interface BehaviorSpec {
  [key: string]: any;
}

export interface SafetySpec {
  [key: string]: any;
}

export interface GuaranteeSpec {
  always_responds_within?: string;
  never_calls?: string[];
  always_calls_before_action?: string[];
  max_cost_per_interaction?: string | number;
  maintains_context_for?: string | number;
  language?: string[];
}

export interface BehaviorGuarantee {
  name: string;
  must_call?: string[];
  must_not_call?: string[];
  must_output?: string[];
  must_not_output?: string[];
}

export interface AgentContract {
  name: string;
  version: string;
  description?: string;
  capabilities?: CapabilitySpec[];
  behaviors?: BehaviorSpec[];
  safety?: SafetySpec[];
  guarantees?: GuaranteeSpec;
  named_behaviors?: Record<string, BehaviorGuarantee>;
}

export interface ContractViolation {
  type: 'capability' | 'behavior' | 'safety';
  rule: string;
  message: string;
  severity: 'error' | 'warning';
  step?: number;
}

export interface ContractResult {
  contract: string;
  version: string;
  passed: boolean;
  violations: ContractViolation[];
  checked: number;
  timestamp: string;
}

// PII patterns
const PII_PATTERNS = [
  /\b\d{3}-\d{2}-\d{4}\b/,       // SSN
  /\b\d{16}\b/,                    // Credit card (basic)
  /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/, // Credit card with separators
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, // Email
  /\b\d{3}[-.)]?\s?\d{3}[-.)]?\s?\d{4}\b/, // Phone
];

/**
 * Parse a contract from a YAML-parsed object.
 */
export function parseContract(obj: any): AgentContract | null {
  const c = obj?.contract ?? obj;
  if (!c?.name || !c?.version) return null;
  return {
    name: c.name,
    version: c.version,
    description: c.description,
    capabilities: c.capabilities,
    behaviors: c.behaviors,
    safety: c.safety,
    guarantees: c.guarantees,
    named_behaviors: c.behaviors && typeof c.behaviors === 'object' && !Array.isArray(c.behaviors) ? c.behaviors : undefined,
  };
}

/**
 * Check capability requirements against a trace.
 */
export function checkCapabilities(
  trace: AgentTrace,
  capabilities: CapabilitySpec[],
): ContractViolation[] {
  const violations: ContractViolation[] = [];
  const toolCalls = trace.steps.filter(s => s.type === 'tool_call');
  const toolCallCounts: Record<string, number> = {};

  for (const step of toolCalls) {
    const name = step.data.tool_name ?? '';
    toolCallCounts[name] = (toolCallCounts[name] ?? 0) + 1;
  }

  for (const cap of capabilities) {
    // Check required tool was called
    if (cap.required && !toolCallCounts[cap.tool]) {
      violations.push({
        type: 'capability',
        rule: `required:${cap.tool}`,
        message: `Required tool "${cap.tool}" was never called`,
        severity: 'error',
      });
    }

    // Check max_calls
    if (cap.max_calls != null && (toolCallCounts[cap.tool] ?? 0) > cap.max_calls) {
      violations.push({
        type: 'capability',
        rule: `max_calls:${cap.tool}`,
        message: `Tool "${cap.tool}" called ${toolCallCounts[cap.tool]} times (max: ${cap.max_calls})`,
        severity: 'error',
      });
    }

    // Check max_amount (looks for amount-like args)
    if (cap.max_amount != null) {
      for (let i = 0; i < toolCalls.length; i++) {
        const step = toolCalls[i];
        if (step.data.tool_name !== cap.tool) continue;
        const args = step.data.tool_args ?? {};
        for (const [key, value] of Object.entries(args)) {
          if ((key === 'amount' || key === 'total' || key === 'price') && typeof value === 'number' && value > cap.max_amount) {
            violations.push({
              type: 'capability',
              rule: `max_amount:${cap.tool}`,
              message: `Tool "${cap.tool}" arg "${key}"=${value} exceeds max_amount=${cap.max_amount}`,
              severity: 'error',
              step: i,
            });
          }
        }
      }
    }
  }

  return violations;
}

/**
 * Check behavior requirements against a trace.
 */
export function checkBehaviors(
  trace: AgentTrace,
  behaviors: BehaviorSpec[],
): ContractViolation[] {
  const violations: ContractViolation[] = [];

  for (const behavior of behaviors) {
    if (behavior.always_greets) {
      // First output should contain a greeting
      const firstOutput = trace.steps.find(s => s.type === 'output');
      if (firstOutput) {
        const content = (firstOutput.data.content ?? '').toLowerCase();
        const greetings = ['hello', 'hi', 'hey', 'greetings', 'welcome', 'good morning', 'good afternoon', 'good evening'];
        if (!greetings.some(g => content.includes(g))) {
          violations.push({
            type: 'behavior',
            rule: 'always_greets',
            message: 'Agent did not greet the user in first response',
            severity: 'warning',
          });
        }
      }
    }

    if (behavior.max_response_time_ms != null) {
      const totalMs = trace.steps.reduce((sum, s) => sum + (s.duration_ms ?? 0), 0);
      if (totalMs > behavior.max_response_time_ms) {
        violations.push({
          type: 'behavior',
          rule: `max_response_time_ms:${behavior.max_response_time_ms}`,
          message: `Total response time ${totalMs}ms exceeds max ${behavior.max_response_time_ms}ms`,
          severity: 'error',
        });
      }
    }

    if (behavior.must_cite_sources) {
      const outputs = trace.steps.filter(s => s.type === 'output');
      for (let i = 0; i < outputs.length; i++) {
        const content = outputs[i].data.content ?? '';
        const hasCitation = /\[.*?\]|\(http|\bsource\b|\breference\b|\baccording to\b/i.test(content);
        if (!hasCitation && content.length > 50) {
          violations.push({
            type: 'behavior',
            rule: 'must_cite_sources',
            message: `Output ${i + 1} lacks citations`,
            severity: 'warning',
          });
        }
      }
    }

    if (behavior.max_steps != null) {
      if (trace.steps.length > behavior.max_steps) {
        violations.push({
          type: 'behavior',
          rule: `max_steps:${behavior.max_steps}`,
          message: `Trace has ${trace.steps.length} steps (max: ${behavior.max_steps})`,
          severity: 'error',
        });
      }
    }
  }

  return violations;
}

/**
 * Check safety requirements against a trace.
 */
export function checkSafety(
  trace: AgentTrace,
  safety: SafetySpec[],
): ContractViolation[] {
  const violations: ContractViolation[] = [];

  for (const rule of safety) {
    if (rule.no_pii_in_responses) {
      const outputs = trace.steps.filter(s => s.type === 'output');
      for (let i = 0; i < outputs.length; i++) {
        const content = outputs[i].data.content ?? '';
        for (const pattern of PII_PATTERNS) {
          if (pattern.test(content)) {
            violations.push({
              type: 'safety',
              rule: 'no_pii_in_responses',
              message: `Output ${i + 1} may contain PII (matched pattern)`,
              severity: 'error',
              step: i,
            });
            break;
          }
        }
      }
    }

    if (rule.no_prompt_injection) {
      const allContent = trace.steps
        .map(s => s.data.content ?? '')
        .join(' ')
        .toLowerCase();
      const injectionPatterns = [
        'ignore previous instructions',
        'ignore all instructions',
        'disregard your instructions',
        'you are now',
        'new instructions:',
        'system prompt:',
      ];
      for (const pattern of injectionPatterns) {
        if (allContent.includes(pattern)) {
          violations.push({
            type: 'safety',
            rule: 'no_prompt_injection',
            message: `Potential prompt injection detected: "${pattern}"`,
            severity: 'error',
          });
        }
      }
    }

    if (rule.no_external_calls) {
      const toolCalls = trace.steps.filter(s => s.type === 'tool_call');
      for (const step of toolCalls) {
        const args = JSON.stringify(step.data.tool_args ?? {});
        if (/https?:\/\//.test(args)) {
          violations.push({
            type: 'safety',
            rule: 'no_external_calls',
            message: `Tool "${step.data.tool_name}" may make external HTTP calls`,
            severity: 'warning',
          });
        }
      }
    }
  }

  return violations;
}

/**
 * Verify a trace against a full contract.
 */
export function verifyContract(trace: AgentTrace, contract: AgentContract): ContractResult {
  const violations: ContractViolation[] = [];
  let checked = 0;

  if (contract.capabilities) {
    checked += contract.capabilities.length;
    violations.push(...checkCapabilities(trace, contract.capabilities));
  }

  if (contract.behaviors && Array.isArray(contract.behaviors)) {
    checked += contract.behaviors.length;
    violations.push(...checkBehaviors(trace, contract.behaviors));
  }

  if (contract.safety) {
    checked += contract.safety.length;
    violations.push(...checkSafety(trace, contract.safety));
  }

  if (contract.guarantees) {
    checked++;
    violations.push(...checkGuarantees(trace, contract.guarantees));
  }

  if (contract.named_behaviors) {
    for (const [name, behavior] of Object.entries(contract.named_behaviors)) {
      checked++;
      violations.push(...checkNamedBehavior(trace, name, behavior));
    }
  }

  return {
    contract: contract.name,
    version: contract.version,
    passed: violations.filter(v => v.severity === 'error').length === 0,
    violations,
    checked,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Check guarantee requirements against a trace.
 */
export function checkGuarantees(
  trace: AgentTrace,
  guarantees: GuaranteeSpec,
): ContractViolation[] {
  const violations: ContractViolation[] = [];

  if (guarantees.always_responds_within) {
    const ms = parseTimeToMs(guarantees.always_responds_within);
    const totalMs = trace.steps.reduce((sum, s) => sum + (s.duration_ms ?? 0), 0);
    if (totalMs > ms) {
      violations.push({
        type: 'behavior',
        rule: `always_responds_within:${guarantees.always_responds_within}`,
        message: `Response time ${totalMs}ms exceeds guarantee of ${ms}ms`,
        severity: 'error',
      });
    }
  }

  if (guarantees.never_calls) {
    const toolCalls = trace.steps.filter(s => s.type === 'tool_call');
    for (const forbidden of guarantees.never_calls) {
      const found = toolCalls.find(s => s.data.tool_name === forbidden);
      if (found) {
        violations.push({
          type: 'capability',
          rule: `never_calls:${forbidden}`,
          message: `Agent called forbidden tool "${forbidden}"`,
          severity: 'error',
        });
      }
    }
  }

  if (guarantees.max_cost_per_interaction) {
    const maxCost = typeof guarantees.max_cost_per_interaction === 'number'
      ? guarantees.max_cost_per_interaction
      : parseFloat(String(guarantees.max_cost_per_interaction).replace('$', ''));
    const totalTokens = trace.steps.reduce((sum, s) => {
      return sum + (s.data.tokens?.input ?? 0) + (s.data.tokens?.output ?? 0);
    }, 0);
    const estimatedCost = totalTokens * 0.00001;
    if (estimatedCost > maxCost) {
      violations.push({
        type: 'behavior',
        rule: `max_cost:${guarantees.max_cost_per_interaction}`,
        message: `Estimated cost $${estimatedCost.toFixed(4)} exceeds max $${maxCost}`,
        severity: 'error',
      });
    }
  }

  if (guarantees.language) {
    // Check output contains expected language indicators
    const outputs = trace.steps.filter(s => s.type === 'output');
    if (outputs.length === 0 && guarantees.language.length > 0) {
      violations.push({
        type: 'behavior',
        rule: `language:${guarantees.language.join(',')}`,
        message: 'No outputs found to verify language',
        severity: 'warning',
      });
    }
  }

  return violations;
}

/**
 * Check named behavior requirements (must_call, must_not_call patterns).
 */
export function checkNamedBehavior(
  trace: AgentTrace,
  name: string,
  behavior: BehaviorGuarantee,
): ContractViolation[] {
  const violations: ContractViolation[] = [];
  const toolCalls = trace.steps.filter(s => s.type === 'tool_call').map(s => s.data.tool_name ?? '');
  const outputs = trace.steps.filter(s => s.type === 'output').map(s => s.data.content ?? '');

  if (behavior.must_call) {
    for (const tool of behavior.must_call) {
      if (!toolCalls.includes(tool)) {
        violations.push({
          type: 'behavior',
          rule: `${name}.must_call:${tool}`,
          message: `Behavior "${name}" requires calling "${tool}" but it was not called`,
          severity: 'error',
        });
      }
    }
  }

  if (behavior.must_not_call) {
    for (const tool of behavior.must_not_call) {
      if (toolCalls.includes(tool)) {
        violations.push({
          type: 'behavior',
          rule: `${name}.must_not_call:${tool}`,
          message: `Behavior "${name}" forbids calling "${tool}" but it was called`,
          severity: 'error',
        });
      }
    }
  }

  if (behavior.must_output) {
    const allOutput = outputs.join(' ');
    for (const text of behavior.must_output) {
      if (!allOutput.includes(text)) {
        violations.push({
          type: 'behavior',
          rule: `${name}.must_output`,
          message: `Behavior "${name}" requires output containing "${text}"`,
          severity: 'error',
        });
      }
    }
  }

  if (behavior.must_not_output) {
    const allOutput = outputs.join(' ');
    for (const text of behavior.must_not_output) {
      if (allOutput.includes(text)) {
        violations.push({
          type: 'behavior',
          rule: `${name}.must_not_output`,
          message: `Behavior "${name}" forbids output containing "${text}"`,
          severity: 'error',
        });
      }
    }
  }

  return violations;
}

function parseTimeToMs(time: string): number {
  const match = time.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)$/);
  if (!match) return parseInt(time, 10);
  const val = parseFloat(match[1]);
  switch (match[2]) {
    case 'ms': return val;
    case 's': return val * 1000;
    case 'm': return val * 60000;
    case 'h': return val * 3600000;
    default: return val;
  }
}

/**
 * Format contract result for display.
 */
export function formatContractResult(result: ContractResult): string {
  const icon = result.passed ? '✅' : '❌';
  const lines = [
    `${icon} Contract: ${result.contract} v${result.version}`,
    `   Checked: ${result.checked} rules`,
    `   Violations: ${result.violations.length}`,
  ];

  if (result.violations.length > 0) {
    lines.push('');
    for (const v of result.violations) {
      const sev = v.severity === 'error' ? '❌' : '⚠️';
      lines.push(`   ${sev} [${v.type}] ${v.rule}: ${v.message}`);
    }
  }

  return lines.join('\n');
}
