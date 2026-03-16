/**
 * Trace Validator — Validate trace file format with detailed diagnostics.
 */

import type { StepType } from './types';

export interface TraceValidationResult {
  valid: boolean;
  errors: TraceValidationMessage[];
  warnings: TraceValidationMessage[];
}

export interface TraceValidationMessage {
  level: 'error' | 'warning';
  message: string;
  path?: string;
}

const VALID_STEP_TYPES: StepType[] = ['llm_call', 'tool_call', 'tool_result', 'thought', 'output'];

/**
 * Validate a trace object (already parsed from JSON).
 */
export function validateTraceFormat(trace: any): TraceValidationResult {
  const errors: TraceValidationMessage[] = [];
  const warnings: TraceValidationMessage[] = [];

  // Check it's an object
  if (!trace || typeof trace !== 'object') {
    errors.push({ level: 'error', message: 'Trace must be a JSON object' });
    return { valid: false, errors, warnings };
  }

  // Check required top-level fields
  if (!trace.id) {
    warnings.push({ level: 'warning', message: 'Missing "id" field', path: 'id' });
  }
  if (!trace.timestamp) {
    warnings.push({ level: 'warning', message: 'Missing "timestamp" field', path: 'timestamp' });
  }

  // Check steps array
  if (!Array.isArray(trace.steps)) {
    errors.push({ level: 'error', message: 'Missing or invalid "steps" array', path: 'steps' });
    return { valid: false, errors, warnings };
  }

  // Validate each step
  for (let i = 0; i < trace.steps.length; i++) {
    const step = trace.steps[i];
    const prefix = `steps[${i}]`;

    if (!step || typeof step !== 'object') {
      errors.push({ level: 'error', message: `${prefix}: Step must be an object`, path: prefix });
      continue;
    }

    // type field
    if (!step.type) {
      errors.push({ level: 'error', message: `${prefix}: Missing "type" field`, path: `${prefix}.type` });
    } else if (!VALID_STEP_TYPES.includes(step.type)) {
      warnings.push({
        level: 'warning',
        message: `${prefix}: Unknown step type "${step.type}"`,
        path: `${prefix}.type`,
      });
    }

    // data field  
    if (!step.data && step.type !== 'thought') {
      warnings.push({
        level: 'warning',
        message: `${prefix}: Missing "data" field`,
        path: `${prefix}.data`,
      });
    }

    // timestamp
    if (!step.timestamp) {
      warnings.push({
        level: 'warning',
        message: `Step ${i} missing timestamp`,
        path: `${prefix}.timestamp`,
      });
    }

    // Tool call specific validation
    if (step.type === 'tool_call' && step.data) {
      if (!step.data.tool_name) {
        errors.push({
          level: 'error',
          message: `${prefix}: Tool call missing "tool_name"`,
          path: `${prefix}.data.tool_name`,
        });
      }
      if (step.data.tool_args !== undefined && typeof step.data.tool_args !== 'object') {
        warnings.push({
          level: 'warning',
          message: `${prefix}: tool_args should be an object`,
          path: `${prefix}.data.tool_args`,
        });
      }
    }

    // LLM call specific validation
    if (step.type === 'llm_call' && step.data) {
      if (!step.data.model) {
        warnings.push({
          level: 'warning',
          message: `No model field on LLM call at step ${i}`,
          path: `${prefix}.data.model`,
        });
      }
    }

    // Output specific validation
    if (step.type === 'output' && step.data) {
      if (step.data.content === undefined) {
        warnings.push({
          level: 'warning',
          message: `${prefix}: Output step missing "content"`,
          path: `${prefix}.data.content`,
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate a raw JSON string as a trace file.
 */
export function validateTraceFile(jsonString: string): TraceValidationResult {
  try {
    const parsed = JSON.parse(jsonString);
    return validateTraceFormat(parsed);
  } catch (e: any) {
    return {
      valid: false,
      errors: [{ level: 'error', message: `Invalid JSON: ${e.message}` }],
      warnings: [],
    };
  }
}

/**
 * Format validation results for CLI.
 */
export function formatTraceValidation(result: TraceValidationResult): string {
  const lines: string[] = [];

  if (result.valid && result.warnings.length === 0) {
    lines.push('✓ Trace is valid');
    return lines.join('\n');
  }

  for (const e of result.errors) {
    lines.push(`✗ Error: ${e.message}`);
  }
  for (const w of result.warnings) {
    lines.push(`⚠ Warning: ${w.message}`);
  }

  if (result.valid) {
    lines.unshift('✓ Valid (with warnings)');
  } else {
    lines.unshift('✗ Invalid trace');
  }

  return lines.join('\n');
}
