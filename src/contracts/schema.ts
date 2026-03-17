/**
 * Contract Schema — Type definitions for agent behavioral contracts
 *
 * Four contract types:
 * - Input Contract: what inputs an agent accepts
 * - Output Contract: what outputs must look like
 * - Behavior Contract: behavioral guarantees (tool ordering, timing, limits)
 * - Safety Contract: safety invariants (PII, code execution, confirmation)
 */

// ===== Input Contract =====

export interface InputFieldSpec {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required?: boolean;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  enum?: any[];
  description?: string;
}

export interface InputContract {
  required?: string[];
  fields?: Record<string, InputFieldSpec>;
}

// ===== Output Contract =====

export interface OutputSchemaSpec {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required?: string[];
  properties?: Record<string, OutputSchemaSpec>;
  items?: OutputSchemaSpec;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
  enum?: any[];
}

export interface OutputContract {
  schema?: OutputSchemaSpec;
  contains?: string[];
  not_contains?: string[];
  max_length?: number;
  min_length?: number;
  format?: 'json' | 'markdown' | 'plain';
}

// ===== Behavior Contract =====

export interface BehaviorRule {
  always_calls?: string[];
  never_calls?: string[];
  calls_before?: { tool: string; before: string };
  max_tool_calls?: number;
  min_tool_calls?: number;
  max_response_time_ms?: number;
  max_steps?: number;
  tool_sequence?: string[];
  max_retries?: number;
  idempotent_tools?: string[];
}

export interface BehaviorContract {
  rules: BehaviorRule[];
}

// ===== Safety Contract =====

export interface SafetyRule {
  no_pii_in_output?: boolean;
  no_code_execution?: boolean;
  requires_confirmation?: string[];
  no_external_urls?: boolean;
  no_prompt_injection?: boolean;
  max_output_tokens?: number;
  allowed_tools_only?: string[];
  blocked_patterns?: string[];
}

export interface SafetyContract {
  rules: SafetyRule[];
}

// ===== Full Agent Contract =====

export interface AgentContract {
  name: string;
  version?: string;
  description?: string;
  input?: InputContract;
  output?: OutputContract;
  behavior?: BehaviorContract;
  safety?: SafetyContract;
}

// ===== Violation =====

export type ViolationType = 'input' | 'output' | 'behavior' | 'safety';
export type Severity = 'error' | 'warning' | 'info';

export interface ContractViolation {
  type: ViolationType;
  rule: string;
  message: string;
  severity: Severity;
  expected?: any;
  actual?: any;
  step?: number;
}

export interface ContractResult {
  contract: string;
  version: string;
  passed: boolean;
  violations: ContractViolation[];
  checkedRules: number;
  timestamp: string;
  duration_ms: number;
  summary: {
    errors: number;
    warnings: number;
    info: number;
  };
}

// ===== YAML DSL parsing =====

export interface ContractYAML {
  contracts: ContractYAMLEntry[];
}

export interface ContractYAMLEntry {
  name: string;
  version?: string;
  description?: string;
  input?: {
    required?: string[];
    fields?: Record<string, any>;
  };
  output?: {
    schema?: any;
    contains?: string[];
    not_contains?: string[];
    max_length?: number;
    format?: string;
  };
  behavior?: BehaviorRule[];
  safety?: SafetyRule[];
}

/**
 * Parse a YAML DSL entry into an AgentContract.
 */
export function parseContractYAML(entry: ContractYAMLEntry): AgentContract {
  const contract: AgentContract = {
    name: entry.name,
    version: entry.version ?? '1.0',
    description: entry.description,
  };

  if (entry.input) {
    contract.input = {
      required: entry.input.required,
      fields: entry.input.fields ? parseInputFields(entry.input.fields) : undefined,
    };
  }

  if (entry.output) {
    contract.output = {
      schema: entry.output.schema ? parseOutputSchema(entry.output.schema) : undefined,
      contains: entry.output.contains,
      not_contains: entry.output.not_contains,
      max_length: entry.output.max_length,
      format: entry.output.format as OutputContract['format'],
    };
  }

  if (entry.behavior) {
    contract.behavior = { rules: entry.behavior };
  }

  if (entry.safety) {
    contract.safety = { rules: entry.safety };
  }

  return contract;
}

function parseInputFields(fields: Record<string, any>): Record<string, InputFieldSpec> {
  const result: Record<string, InputFieldSpec> = {};
  for (const [name, spec] of Object.entries(fields)) {
    if (typeof spec === 'string') {
      result[name] = { type: spec as InputFieldSpec['type'] };
    } else {
      result[name] = spec;
    }
  }
  return result;
}

function parseOutputSchema(schema: any): OutputSchemaSpec {
  if (typeof schema === 'string') {
    return { type: schema as OutputSchemaSpec['type'] };
  }
  return schema;
}

/**
 * Parse a full YAML DSL document into contracts.
 */
export function parseContractsFromYAML(doc: ContractYAML): AgentContract[] {
  return (doc.contracts ?? []).map(parseContractYAML);
}
