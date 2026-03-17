/**
 * Contract Validator — Validate agent traces against behavioral contracts
 */

import type { AgentTrace } from '../types';
import type {
  AgentContract,
  BehaviorRule,
  ContractResult,
  ContractViolation,
  InputContract,
  OutputContract,
  OutputSchemaSpec,
  SafetyRule,
  Severity,
  ViolationType,
} from './schema';

// PII detection patterns
const PII_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'SSN', pattern: /\b\d{3}-\d{2}-\d{4}\b/ },
  { name: 'Credit Card', pattern: /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/ },
  { name: 'Email', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/ },
  { name: 'Phone', pattern: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/ },
  { name: 'IP Address', pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/ },
];

// Code execution indicators
const CODE_EXEC_PATTERNS = [
  'eval(', 'exec(', 'subprocess', 'os.system', 'child_process',
  'shell_exec', 'Runtime.exec', '`rm ', '`sudo ',
];

function violation(
  type: ViolationType,
  rule: string,
  message: string,
  severity: Severity = 'error',
  extra?: Partial<ContractViolation>,
): ContractViolation {
  return { type, rule, message, severity, ...extra };
}

// ===== Input validation =====

export function validateInput(
  input: Record<string, any>,
  contract: InputContract,
): ContractViolation[] {
  const violations: ContractViolation[] = [];

  if (contract.required) {
    for (const field of contract.required) {
      if (!(field in input) || input[field] == null || input[field] === '') {
        violations.push(violation('input', `required:${field}`, `Missing required input field "${field}"`, 'error', {
          expected: 'present',
          actual: 'missing',
        }));
      }
    }
  }

  if (contract.fields) {
    for (const [name, spec] of Object.entries(contract.fields)) {
      if (!(name in input)) {
        if (spec.required) {
          violations.push(violation('input', `field:${name}`, `Required field "${name}" is missing`));
        }
        continue;
      }
      const val = input[name];
      const actualType = Array.isArray(val) ? 'array' : typeof val;
      if (actualType !== spec.type) {
        violations.push(violation('input', `type:${name}`, `Field "${name}" expected type "${spec.type}", got "${actualType}"`, 'error', {
          expected: spec.type,
          actual: actualType,
        }));
      }
      if (spec.type === 'number' && typeof val === 'number') {
        if (spec.min != null && val < spec.min) {
          violations.push(violation('input', `min:${name}`, `Field "${name}" value ${val} below min ${spec.min}`));
        }
        if (spec.max != null && val > spec.max) {
          violations.push(violation('input', `max:${name}`, `Field "${name}" value ${val} above max ${spec.max}`));
        }
      }
      if (spec.type === 'string' && typeof val === 'string') {
        if (spec.minLength != null && val.length < spec.minLength) {
          violations.push(violation('input', `minLength:${name}`, `Field "${name}" length ${val.length} below min ${spec.minLength}`));
        }
        if (spec.maxLength != null && val.length > spec.maxLength) {
          violations.push(violation('input', `maxLength:${name}`, `Field "${name}" length ${val.length} above max ${spec.maxLength}`));
        }
        if (spec.pattern && !new RegExp(spec.pattern).test(val)) {
          violations.push(violation('input', `pattern:${name}`, `Field "${name}" does not match pattern "${spec.pattern}"`));
        }
        if (spec.enum && !spec.enum.includes(val)) {
          violations.push(violation('input', `enum:${name}`, `Field "${name}" value "${val}" not in allowed values`, 'error', {
            expected: spec.enum,
            actual: val,
          }));
        }
      }
    }
  }

  return violations;
}

// ===== Output validation =====

export function validateOutput(
  trace: AgentTrace,
  contract: OutputContract,
): ContractViolation[] {
  const violations: ContractViolation[] = [];
  const outputs = trace.steps.filter(s => s.type === 'output');
  const allContent = outputs.map(s => s.data.content ?? '').join('\n');

  if (contract.contains) {
    for (const text of contract.contains) {
      if (!allContent.includes(text)) {
        violations.push(violation('output', `contains:${text}`, `Output missing required text: "${text}"`));
      }
    }
  }

  if (contract.not_contains) {
    for (const text of contract.not_contains) {
      if (allContent.includes(text)) {
        violations.push(violation('output', `not_contains:${text}`, `Output contains forbidden text: "${text}"`));
      }
    }
  }

  if (contract.max_length != null && allContent.length > contract.max_length) {
    violations.push(violation('output', 'max_length', `Output length ${allContent.length} exceeds max ${contract.max_length}`, 'error', {
      expected: contract.max_length,
      actual: allContent.length,
    }));
  }

  if (contract.min_length != null && allContent.length < contract.min_length) {
    violations.push(violation('output', 'min_length', `Output length ${allContent.length} below min ${contract.min_length}`));
  }

  if (contract.format === 'json') {
    for (let i = 0; i < outputs.length; i++) {
      const content = outputs[i].data.content ?? '';
      if (content.trim()) {
        try {
          JSON.parse(content);
        } catch {
          violations.push(violation('output', 'format:json', `Output ${i + 1} is not valid JSON`, 'error', { step: i }));
        }
      }
    }
  }

  if (contract.schema) {
    for (let i = 0; i < outputs.length; i++) {
      const content = outputs[i].data.content ?? '';
      if (!content.trim()) continue;
      try {
        const parsed = JSON.parse(content);
        violations.push(...validateSchema(parsed, contract.schema, `output[${i}]`));
      } catch {
        violations.push(violation('output', 'schema', `Output ${i + 1} is not valid JSON for schema validation`, 'error', { step: i }));
      }
    }
  }

  return violations;
}

function validateSchema(value: any, schema: OutputSchemaSpec, path: string): ContractViolation[] {
  const violations: ContractViolation[] = [];
  const actualType = Array.isArray(value) ? 'array' : typeof value;

  if (schema.type && actualType !== schema.type) {
    violations.push(violation('output', `schema:${path}`, `Expected type "${schema.type}" at ${path}, got "${actualType}"`));
    return violations;
  }

  if (schema.type === 'object' && schema.required && typeof value === 'object' && value !== null) {
    for (const field of schema.required) {
      if (!(field in value)) {
        violations.push(violation('output', `schema:${path}.${field}`, `Missing required field "${field}" at ${path}`));
      }
    }
  }

  if (schema.type === 'object' && schema.properties && typeof value === 'object' && value !== null) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (key in value) {
        violations.push(...validateSchema(value[key], propSchema, `${path}.${key}`));
      }
    }
  }

  if (schema.type === 'array' && schema.items && Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      violations.push(...validateSchema(value[i], schema.items, `${path}[${i}]`));
    }
  }

  return violations;
}

// ===== Behavior validation =====

export function validateBehavior(
  trace: AgentTrace,
  rules: BehaviorRule[],
): ContractViolation[] {
  const violations: ContractViolation[] = [];
  const toolCalls = trace.steps.filter(s => s.type === 'tool_call');
  const toolNames = toolCalls.map(s => s.data.tool_name ?? '');
  const toolSet = new Set(toolNames);
  const totalMs = trace.steps.reduce((sum, s) => sum + (s.duration_ms ?? 0), 0);

  for (const rule of rules) {
    if (rule.always_calls) {
      for (const tool of rule.always_calls) {
        if (!toolSet.has(tool)) {
          violations.push(violation('behavior', `always_calls:${tool}`, `Required tool "${tool}" was never called`));
        }
      }
    }

    if (rule.never_calls) {
      for (const tool of rule.never_calls) {
        if (toolSet.has(tool)) {
          violations.push(violation('behavior', `never_calls:${tool}`, `Forbidden tool "${tool}" was called`));
        }
      }
    }

    if (rule.calls_before) {
      const { tool, before } = rule.calls_before;
      const toolIdx = toolNames.indexOf(tool);
      const beforeIdx = toolNames.indexOf(before);
      if (toolIdx >= 0 && beforeIdx >= 0 && toolIdx > beforeIdx) {
        violations.push(violation('behavior', `calls_before:${tool}->${before}`,
          `Tool "${tool}" must be called before "${before}" but was called after`));
      }
      if (toolIdx < 0 && beforeIdx >= 0) {
        violations.push(violation('behavior', `calls_before:${tool}`,
          `Tool "${tool}" was not called but is required before "${before}"`));
      }
    }

    if (rule.max_tool_calls != null && toolCalls.length > rule.max_tool_calls) {
      violations.push(violation('behavior', 'max_tool_calls',
        `${toolCalls.length} tool calls exceed max ${rule.max_tool_calls}`, 'error', {
          expected: rule.max_tool_calls,
          actual: toolCalls.length,
        }));
    }

    if (rule.min_tool_calls != null && toolCalls.length < rule.min_tool_calls) {
      violations.push(violation('behavior', 'min_tool_calls',
        `${toolCalls.length} tool calls below min ${rule.min_tool_calls}`));
    }

    if (rule.max_response_time_ms != null && totalMs > rule.max_response_time_ms) {
      violations.push(violation('behavior', 'max_response_time_ms',
        `Response time ${totalMs}ms exceeds max ${rule.max_response_time_ms}ms`, 'error', {
          expected: rule.max_response_time_ms,
          actual: totalMs,
        }));
    }

    if (rule.max_steps != null && trace.steps.length > rule.max_steps) {
      violations.push(violation('behavior', 'max_steps',
        `${trace.steps.length} steps exceed max ${rule.max_steps}`));
    }

    if (rule.tool_sequence) {
      const expected = rule.tool_sequence;
      let ei = 0;
      for (const name of toolNames) {
        if (ei < expected.length && name === expected[ei]) ei++;
      }
      if (ei < expected.length) {
        violations.push(violation('behavior', 'tool_sequence',
          `Expected tool sequence ${JSON.stringify(expected)} not found in trace`, 'error', {
            expected,
            actual: toolNames,
          }));
      }
    }
  }

  return violations;
}

// ===== Safety validation =====

export function validateSafety(
  trace: AgentTrace,
  rules: SafetyRule[],
): ContractViolation[] {
  const violations: ContractViolation[] = [];
  const outputs = trace.steps.filter(s => s.type === 'output');
  const toolCalls = trace.steps.filter(s => s.type === 'tool_call');
  const allOutputContent = outputs.map(s => s.data.content ?? '').join('\n');

  for (const rule of rules) {
    if (rule.no_pii_in_output) {
      for (let i = 0; i < outputs.length; i++) {
        const content = outputs[i].data.content ?? '';
        for (const { name, pattern } of PII_PATTERNS) {
          if (pattern.test(content)) {
            violations.push(violation('safety', 'no_pii_in_output',
              `Output ${i + 1} may contain PII (${name})`, 'error', { step: i }));
            break;
          }
        }
      }
    }

    if (rule.no_code_execution) {
      for (const step of toolCalls) {
        const argsStr = JSON.stringify(step.data.tool_args ?? {});
        for (const pattern of CODE_EXEC_PATTERNS) {
          if (argsStr.includes(pattern)) {
            violations.push(violation('safety', 'no_code_execution',
              `Tool "${step.data.tool_name}" args contain code execution indicator: "${pattern}"`));
            break;
          }
        }
      }
    }

    if (rule.requires_confirmation) {
      for (const tool of rule.requires_confirmation) {
        const toolIdx = toolCalls.findIndex(s => s.data.tool_name === tool);
        if (toolIdx < 0) continue;
        // Check if there's a confirmation step (user output with confirm-like content) before it
        const priorSteps = trace.steps.slice(0, trace.steps.indexOf(toolCalls[toolIdx]));
        const hasConfirmation = priorSteps.some(s =>
          s.type === 'output' && /confirm|are you sure|proceed/i.test(s.data.content ?? '')
        );
        if (!hasConfirmation) {
          violations.push(violation('safety', `requires_confirmation:${tool}`,
            `Tool "${tool}" was called without prior confirmation step`));
        }
      }
    }

    if (rule.no_external_urls) {
      for (const step of toolCalls) {
        const argsStr = JSON.stringify(step.data.tool_args ?? {});
        if (/https?:\/\//.test(argsStr)) {
          violations.push(violation('safety', 'no_external_urls',
            `Tool "${step.data.tool_name}" contains external URL in args`, 'warning'));
        }
      }
    }

    if (rule.no_prompt_injection) {
      const allContent = trace.steps.map(s => s.data.content ?? '').join(' ').toLowerCase();
      const injectionPatterns = [
        'ignore previous instructions', 'ignore all instructions',
        'disregard your instructions', 'you are now', 'new instructions:',
        'system prompt:', 'forget everything',
      ];
      for (const p of injectionPatterns) {
        if (allContent.includes(p)) {
          violations.push(violation('safety', 'no_prompt_injection',
            `Potential prompt injection detected: "${p}"`));
        }
      }
    }

    if (rule.allowed_tools_only) {
      const allowed = new Set(rule.allowed_tools_only);
      for (const step of toolCalls) {
        const name = step.data.tool_name ?? '';
        if (!allowed.has(name)) {
          violations.push(violation('safety', `allowed_tools_only:${name}`,
            `Tool "${name}" is not in the allowed tools list`));
        }
      }
    }

    if (rule.blocked_patterns) {
      for (const pattern of rule.blocked_patterns) {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(allOutputContent)) {
          violations.push(violation('safety', `blocked_pattern:${pattern}`,
            `Output matches blocked pattern: "${pattern}"`));
        }
      }
    }

    if (rule.max_output_tokens != null) {
      const totalTokens = outputs.reduce((sum, s) => sum + (s.data.tokens?.output ?? 0), 0);
      if (totalTokens > rule.max_output_tokens) {
        violations.push(violation('safety', 'max_output_tokens',
          `Output tokens ${totalTokens} exceed max ${rule.max_output_tokens}`, 'warning'));
      }
    }
  }

  return violations;
}

// ===== Main validator =====

/**
 * Validate a trace against a full contract. Returns detailed results.
 */
export function validateContract(
  trace: AgentTrace,
  contract: AgentContract,
  input?: Record<string, any>,
): ContractResult {
  const start = Date.now();
  const violations: ContractViolation[] = [];
  let checkedRules = 0;

  if (contract.input && input) {
    checkedRules++;
    violations.push(...validateInput(input, contract.input));
  }

  if (contract.output) {
    checkedRules++;
    violations.push(...validateOutput(trace, contract.output));
  }

  if (contract.behavior) {
    checkedRules += contract.behavior.rules.length;
    violations.push(...validateBehavior(trace, contract.behavior.rules));
  }

  if (contract.safety) {
    checkedRules += contract.safety.rules.length;
    violations.push(...validateSafety(trace, contract.safety.rules));
  }

  const errors = violations.filter(v => v.severity === 'error').length;
  const warnings = violations.filter(v => v.severity === 'warning').length;
  const info = violations.filter(v => v.severity === 'info').length;

  return {
    contract: contract.name,
    version: contract.version ?? '1.0',
    passed: errors === 0,
    violations,
    checkedRules,
    timestamp: new Date().toISOString(),
    duration_ms: Date.now() - start,
    summary: { errors, warnings, info },
  };
}
