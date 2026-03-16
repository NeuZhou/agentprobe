/**
 * Test Matrix - Run tests across multiple model/temperature configurations.
 *
 * Creates a matrix of: models × temperatures × other dimensions
 * and reports which combinations pass/fail.
 */

import * as fs from 'fs';
import chalk from 'chalk';
import YAML from 'yaml';
import type { TestCase, TestResult } from './types';

export interface MatrixDimension {
  name: string;
  values: string[];
}

export interface MatrixConfig {
  suiteFile: string;
  models: string[];
  temperatures: number[];
  extraDimensions?: MatrixDimension[];
}

export interface MatrixCell {
  model: string;
  temperature: number;
  extras?: Record<string, string>;
  passed: number;
  failed: number;
  total: number;
  duration_ms: number;
  results: TestResult[];
}

export interface MatrixResult {
  cells: MatrixCell[];
  models: string[];
  temperatures: number[];
  totalConfigs: number;
  summary: {
    allPass: number;
    somePass: number;
    allFail: number;
  };
}

/**
 * Generate all matrix combinations.
 */
export function generateCombinations(config: MatrixConfig): Array<{ model: string; temperature: number; extras?: Record<string, string> }> {
  const combos: Array<{ model: string; temperature: number; extras?: Record<string, string> }> = [];
  for (const model of config.models) {
    for (const temp of config.temperatures) {
      if (config.extraDimensions && config.extraDimensions.length > 0) {
        // Simple: only support one extra dimension for now
        const dim = config.extraDimensions[0];
        for (const val of dim.values) {
          combos.push({ model, temperature: temp, extras: { [dim.name]: val } });
        }
      } else {
        combos.push({ model, temperature: temp });
      }
    }
  }
  return combos;
}

/**
 * Create a simulated matrix result (for when we can't actually call LLMs).
 * In production, this would run the actual tests with each configuration.
 */
export function buildMatrixResult(config: MatrixConfig, tests: TestCase[]): MatrixResult {
  const combos = generateCombinations(config);
  const cells: MatrixCell[] = [];

  for (const combo of combos) {
    // Simulate results based on test count
    const results: TestResult[] = tests.map(t => ({
      name: t.name,
      passed: true, // Placeholder — real run would execute tests
      assertions: [],
      duration_ms: 0,
      tags: t.tags,
    }));
    cells.push({
      model: combo.model,
      temperature: combo.temperature,
      extras: combo.extras,
      passed: results.filter(r => r.passed).length,
      failed: results.filter(r => !r.passed).length,
      total: results.length,
      duration_ms: 0,
      results,
    });
  }

  let allPass = 0, somePass = 0, allFail = 0;
  for (const cell of cells) {
    if (cell.failed === 0) allPass++;
    else if (cell.passed === 0) allFail++;
    else somePass++;
  }

  return {
    cells,
    models: config.models,
    temperatures: config.temperatures,
    totalConfigs: combos.length,
    summary: { allPass, somePass, allFail },
  };
}

/**
 * Parse matrix CLI options.
 */
export function parseMatrixOptions(opts: {
  models?: string;
  temps?: string;
}): { models: string[]; temperatures: number[] } {
  const models = opts.models ? opts.models.split(',').map(m => m.trim()) : ['default'];
  const temperatures = opts.temps ? opts.temps.split(',').map(t => parseFloat(t.trim())) : [0];
  return { models, temperatures };
}

/**
 * Format matrix result as a table for console output.
 */
export function formatMatrix(result: MatrixResult): string {
  const lines: string[] = [];
  lines.push(chalk.bold(`Test Matrix: ${result.models.length} models × ${result.temperatures.length} temps = ${result.totalConfigs} configurations`));
  lines.push('');

  // Header row
  const header = ['Model \\ Temp', ...result.temperatures.map(t => `t=${t}`)];
  lines.push(header.map(h => h.padEnd(16)).join('│'));
  lines.push('─'.repeat(16 * header.length));

  // Data rows
  for (const model of result.models) {
    const row = [model];
    for (const temp of result.temperatures) {
      const cell = result.cells.find(c => c.model === model && c.temperature === temp);
      if (cell) {
        if (cell.failed === 0) {
          row.push(chalk.green(`✓ ${cell.passed}/${cell.total}`));
        } else if (cell.passed === 0) {
          row.push(chalk.red(`✗ 0/${cell.total}`));
        } else {
          row.push(chalk.yellow(`◐ ${cell.passed}/${cell.total}`));
        }
      } else {
        row.push('-');
      }
    }
    lines.push(row.map(r => r.padEnd(16)).join('│'));
  }

  lines.push('');
  lines.push(`Summary: ${chalk.green(`${result.summary.allPass} all-pass`)} │ ${chalk.yellow(`${result.summary.somePass} partial`)} │ ${chalk.red(`${result.summary.allFail} all-fail`)}`);

  return lines.join('\n');
}

/**
 * Load tests from a YAML suite file.
 */
export function loadMatrixTests(suiteFile: string): TestCase[] {
  const raw = YAML.parse(fs.readFileSync(suiteFile, 'utf-8'));
  return raw.tests || [];
}
