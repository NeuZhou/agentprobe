/**
 * Custom Assertion Builder — DSL for building complex assertions from YAML config.
 */

import YAML from 'yaml';
import * as fs from 'fs';
import type { AgentTrace } from './types';

export interface CustomAssertionDef {
  name: string;
  check: string; // JavaScript expression/function body
  description?: string;
}

export interface CustomAssertionConfig {
  assertions: Array<{
    custom: CustomAssertionDef;
  }>;
}

export interface CustomAssertionEvalResult {
  name: string;
  passed: boolean;
  error?: string;
}

/**
 * Parse assertion definitions from YAML string.
 */
export function parseAssertionConfig(yamlStr: string): CustomAssertionConfig {
  return YAML.parse(yamlStr) as CustomAssertionConfig;
}

/**
 * Parse assertion definitions from a file.
 */
export function parseAssertionConfigFile(filePath: string): CustomAssertionConfig {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return parseAssertionConfig(raw);
}

/**
 * Extract assertion definitions from config.
 */
export function extractAssertions(config: CustomAssertionConfig): CustomAssertionDef[] {
  return (config.assertions ?? [])
    .filter((a) => a.custom)
    .map((a) => a.custom);
}

/**
 * Evaluate a single custom assertion against an output string.
 */
export function evaluateAssertion(def: CustomAssertionDef, output: string): CustomAssertionEvalResult {
  try {
    // The check is a JS function body that receives `output` and returns boolean
    const fn = new Function('output', def.check);
    const result = fn(output);
    return {
      name: def.name,
      passed: !!result,
    };
  } catch (err: any) {
    return {
      name: def.name,
      passed: false,
      error: err.message,
    };
  }
}

/**
 * Evaluate a single custom assertion against a trace.
 */
export function evaluateAssertionWithTrace(
  def: CustomAssertionDef,
  trace: AgentTrace,
): CustomAssertionEvalResult {
  const output = trace.steps
    .filter((s) => s.type === 'output')
    .map((s) => s.data.content ?? '')
    .join('\n');
  return evaluateAssertion(def, output);
}

/**
 * Evaluate all assertions from a config against an output.
 */
export function evaluateAll(
  config: CustomAssertionConfig,
  output: string,
): CustomAssertionEvalResult[] {
  const defs = extractAssertions(config);
  return defs.map((def) => evaluateAssertion(def, output));
}

/**
 * Evaluate all assertions from config against a trace.
 */
export function evaluateAllWithTrace(
  config: CustomAssertionConfig,
  trace: AgentTrace,
): CustomAssertionEvalResult[] {
  const defs = extractAssertions(config);
  return defs.map((def) => evaluateAssertionWithTrace(def, trace));
}

/**
 * Build a reusable assertion function from a definition.
 */
export function buildAssertionFn(def: CustomAssertionDef): (output: string) => boolean {
  const fn = new Function('output', def.check) as (output: string) => boolean;
  return fn;
}

/**
 * Validate assertion config structure.
 */
export function validateAssertionConfig(config: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!config?.assertions || !Array.isArray(config.assertions)) {
    errors.push('Missing assertions array');
    return { valid: false, errors };
  }
  for (let i = 0; i < config.assertions.length; i++) {
    const a = config.assertions[i];
    if (!a.custom) {
      errors.push(`assertions[${i}]: missing custom key`);
      continue;
    }
    if (!a.custom.name) {
      errors.push(`assertions[${i}]: missing name`);
    }
    if (!a.custom.check) {
      errors.push(`assertions[${i}]: missing check`);
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Format assertion results for display.
 */
export function formatAssertionResults(results: CustomAssertionEvalResult[]): string {
  const lines: string[] = ['', '🔍 Custom Assertion Results', ''];
  for (const r of results) {
    const icon = r.passed ? '✅' : '❌';
    const err = r.error ? ` (${r.error})` : '';
    lines.push(`  ${icon} ${r.name}${err}`);
  }
  const passed = results.filter((r) => r.passed).length;
  lines.push('');
  lines.push(`  ${passed}/${results.length} passed`);
  lines.push('');
  return lines.join('\n');
}
