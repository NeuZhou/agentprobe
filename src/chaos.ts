/**
 * Agent Chaos Testing — Inject chaos scenarios into agent environments.
 * Supports: api_latency, api_error, tool_failure, response_corruption, context_overflow.
 */

import * as fs from 'fs';
import YAML from 'yaml';
import type { AgentTrace } from './types';

export type ChaosType =
  | 'api_latency'
  | 'api_error'
  | 'tool_failure'
  | 'response_corruption'
  | 'context_overflow';

export interface ChaosScenario {
  type: ChaosType;
  target?: string;
  tool?: string;
  delay_ms?: number;
  error?: string | number;
  probability?: number;
  corrupt_tokens?: string;
  inject_tokens?: number;
}

export interface ChaosConfig {
  chaos: {
    scenarios: ChaosScenario[];
  };
}

export interface ChaosResult {
  scenario: ChaosScenario;
  applied: boolean;
  affectedSteps: number;
  description: string;
}

/**
 * Parse a chaos config from YAML file.
 */
export function parseChaosConfig(filePath: string): ChaosConfig {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return YAML.parse(raw) as ChaosConfig;
}

/**
 * Parse chaos config from a YAML string.
 */
export function parseChaosConfigString(yamlStr: string): ChaosConfig {
  return YAML.parse(yamlStr) as ChaosConfig;
}

/**
 * Get a specific scenario by type from config.
 */
export function getScenario(config: ChaosConfig, type: ChaosType): ChaosScenario | undefined {
  return config.chaos?.scenarios?.find((s) => s.type === type);
}

/**
 * Apply a chaos scenario to a trace (returns a modified copy).
 */
export function applyChaos(trace: AgentTrace, scenario: ChaosScenario): { trace: AgentTrace; result: ChaosResult } {
  const modified: AgentTrace = JSON.parse(JSON.stringify(trace));
  let affectedSteps = 0;

  switch (scenario.type) {
    case 'api_latency': {
      const delay = scenario.delay_ms ?? 5000;
      for (const step of modified.steps) {
        if (step.type === 'llm_call') {
          if (!scenario.target || step.data.model?.includes(scenario.target)) {
            step.duration_ms = (step.duration_ms ?? 0) + delay;
            affectedSteps++;
          }
        }
      }
      break;
    }
    case 'api_error': {
      const prob = scenario.probability ?? 1.0;
      const errCode = scenario.error ?? 500;
      for (const step of modified.steps) {
        if (step.type === 'llm_call') {
          if (!scenario.target || step.data.model?.includes(scenario.target)) {
            if (Math.random() < prob) {
              step.data.content = `Error ${errCode}: API call failed`;
              step.data.tokens = { input: 0, output: 0 };
              affectedSteps++;
            }
          }
        }
      }
      break;
    }
    case 'tool_failure': {
      const errMsg = scenario.error ?? 'tool failure';
      for (const step of modified.steps) {
        if (step.type === 'tool_call' && step.data.tool_name === scenario.tool) {
          affectedSteps++;
        }
        if (step.type === 'tool_result' && modified.steps.some(
          (s) => s.type === 'tool_call' && s.data.tool_name === scenario.tool
        )) {
          step.data.tool_result = { error: errMsg };
          affectedSteps++;
        }
      }
      break;
    }
    case 'response_corruption': {
      const pctStr = scenario.corrupt_tokens ?? '10%';
      const pct = parseInt(pctStr.replace('%', ''), 10) / 100;
      for (const step of modified.steps) {
        if (step.type === 'output' && step.data.content) {
          const chars = step.data.content.split('');
          const numCorrupt = Math.floor(chars.length * pct);
          for (let i = 0; i < numCorrupt; i++) {
            const idx = Math.floor(Math.random() * chars.length);
            chars[idx] = String.fromCharCode(0x2400 + Math.floor(Math.random() * 32));
          }
          step.data.content = chars.join('');
          affectedSteps++;
        }
      }
      break;
    }
    case 'context_overflow': {
      const tokens = scenario.inject_tokens ?? 100000;
      const filler = 'x '.repeat(Math.min(tokens, 50000));
      modified.steps.unshift({
        type: 'llm_call',
        timestamp: new Date().toISOString(),
        data: {
          content: filler,
          tokens: { input: tokens, output: 0 },
        },
      });
      affectedSteps = 1;
      break;
    }
  }

  return {
    trace: modified,
    result: {
      scenario,
      applied: affectedSteps > 0,
      affectedSteps,
      description: describeChaos(scenario),
    },
  };
}

/**
 * Apply multiple chaos scenarios to a trace.
 */
export function applyAllChaos(
  trace: AgentTrace,
  scenarios: ChaosScenario[],
): { trace: AgentTrace; results: ChaosResult[] } {
  let current = trace;
  const results: ChaosResult[] = [];
  for (const scenario of scenarios) {
    const { trace: modified, result } = applyChaos(current, scenario);
    current = modified;
    results.push(result);
  }
  return { trace: current, results };
}

/**
 * Describe a chaos scenario in human-readable form.
 */
export function describeChaos(scenario: ChaosScenario): string {
  switch (scenario.type) {
    case 'api_latency':
      return `Inject ${scenario.delay_ms ?? 5000}ms latency to ${scenario.target ?? 'all'} API calls`;
    case 'api_error':
      return `Inject error ${scenario.error ?? 500} with ${((scenario.probability ?? 1) * 100).toFixed(0)}% probability to ${scenario.target ?? 'all'}`;
    case 'tool_failure':
      return `Fail tool "${scenario.tool ?? 'unknown'}" with: ${scenario.error ?? 'tool failure'}`;
    case 'response_corruption':
      return `Corrupt ${scenario.corrupt_tokens ?? '10%'} of output tokens`;
    case 'context_overflow':
      return `Inject ${scenario.inject_tokens ?? 100000} tokens into context`;
  }
}

/**
 * Format chaos results as a report.
 */
export function formatChaosReport(results: ChaosResult[]): string {
  const lines: string[] = ['', '🌪️  Chaos Test Report', ''];
  for (const r of results) {
    const icon = r.applied ? '💥' : '⏭️';
    lines.push(`  ${icon} ${r.scenario.type}: ${r.description}`);
    lines.push(`     Steps affected: ${r.affectedSteps}`);
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Validate chaos config structure.
 */
export function validateChaosConfig(config: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!config?.chaos?.scenarios) {
    errors.push('Missing chaos.scenarios array');
    return { valid: false, errors };
  }
  if (!Array.isArray(config.chaos.scenarios)) {
    errors.push('chaos.scenarios must be an array');
    return { valid: false, errors };
  }
  const validTypes: ChaosType[] = ['api_latency', 'api_error', 'tool_failure', 'response_corruption', 'context_overflow'];
  for (const s of config.chaos.scenarios) {
    if (!validTypes.includes(s.type)) {
      errors.push(`Invalid chaos type: ${s.type}`);
    }
  }
  return { valid: errors.length === 0, errors };
}
