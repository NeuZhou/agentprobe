/**
 * Doctor Command - System health check for AgentProbe.
 * Validates Node.js version, dependencies, API keys, config, and test files.
 */

import * as fs from 'fs';
import * as path from 'path';

export type CheckStatus = 'ok' | 'warn' | 'error';

export interface DoctorCheck {
  name: string;
  status: CheckStatus;
  message: string;
  detail?: string;
}

export interface DoctorResult {
  checks: DoctorCheck[];
  status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
  warnings: number;
  errors: number;
}

/**
 * Check Node.js version (>= 18 required).
 */
export function checkNodeVersion(): DoctorCheck {
  const version = process.version;
  const major = parseInt(version.slice(1).split('.')[0], 10);

  if (major >= 18) {
    return { name: 'Node.js', status: 'ok', message: `${version} (>= 18 required)` };
  }
  return {
    name: 'Node.js',
    status: 'error',
    message: `${version} — Node.js >= 18 required`,
    detail: 'Upgrade Node.js to version 18 or later',
  };
}

/**
 * Check if TypeScript is available.
 */
export function checkTypeScript(): DoctorCheck {
  try {
    const tsPath = require.resolve('typescript/package.json');
    const tsPkg = JSON.parse(fs.readFileSync(tsPath, 'utf-8'));
    return { name: 'TypeScript', status: 'ok', message: tsPkg.version };
  } catch {
    return {
      name: 'TypeScript',
      status: 'warn',
      message: 'Not found (optional for YAML-only usage)',
    };
  }
}

/**
 * Check if an API key environment variable is set.
 */
export function checkApiKey(name: string, envVar: string, required: boolean): DoctorCheck {
  const value = process.env[envVar];
  if (value && value.length > 0) {
    return { name, status: 'ok', message: `${envVar} configured` };
  }
  return {
    name,
    status: required ? 'error' : 'warn',
    message: `${envVar} not set${required ? '' : ' (optional)'}`,
  };
}

/**
 * Check if test directory exists and count test files.
 */
export function checkTestDirectory(baseDir: string): DoctorCheck {
  const testsDir = path.join(baseDir, 'tests');
  if (!fs.existsSync(testsDir)) {
    return {
      name: 'Tests directory',
      status: 'warn',
      message: 'No tests/ directory found',
      detail: 'Run agentprobe init to create one',
    };
  }

  const files = fs.readdirSync(testsDir).filter(
    (f) => f.endsWith('.yaml') || f.endsWith('.yml') || f.endsWith('.test.ts'),
  );

  if (files.length === 0) {
    return {
      name: 'Tests directory',
      status: 'warn',
      message: 'tests/ exists but no test files found',
    };
  }

  return {
    name: 'Tests directory',
    status: 'ok',
    message: `Found (${files.length} test files)`,
  };
}

/**
 * Check if config file exists and is valid.
 */
export function checkConfigFile(baseDir: string): DoctorCheck {
  const configPath = path.join(baseDir, '.agentprobe', 'config.yml');
  if (!fs.existsSync(configPath)) {
    return {
      name: 'Config file',
      status: 'warn',
      message: 'No .agentprobe/config.yml found',
      detail: 'Run agentprobe init to create one',
    };
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    if (content.length === 0) {
      return { name: 'Config file', status: 'warn', message: 'Config file is empty' };
    }
    return { name: 'Config file', status: 'ok', message: 'Valid' };
  } catch {
    return { name: 'Config file', status: 'error', message: 'Config file is not readable' };
  }
}

/**
 * Run all doctor checks.
 */
export function runDoctor(baseDir?: string): DoctorResult {
  const dir = baseDir ?? process.cwd();

  const checks: DoctorCheck[] = [
    checkNodeVersion(),
    checkTypeScript(),
    checkApiKey('OpenAI API key', 'OPENAI_API_KEY', false),
    checkApiKey('Anthropic API key', 'ANTHROPIC_API_KEY', false),
    checkTestDirectory(dir),
    checkConfigFile(dir),
  ];

  const errors = checks.filter((c) => c.status === 'error').length;
  const warnings = checks.filter((c) => c.status === 'warn').length;

  let status: DoctorResult['status'] = 'HEALTHY';
  if (errors > 0) status = 'UNHEALTHY';
  else if (warnings > 0) status = 'DEGRADED';

  return { checks, status, warnings, errors };
}

/**
 * Format doctor result for console display.
 */
export function formatDoctor(result: DoctorResult): string {
  const lines: string[] = [];
  lines.push('🏥 AgentProbe Doctor');

  for (const check of result.checks) {
    const icon = check.status === 'ok' ? '✅' : check.status === 'warn' ? '⚠️' : '❌';
    lines.push(`${icon} ${check.name}: ${check.message}`);
    if (check.detail) lines.push(`   → ${check.detail}`);
  }

  const suffix: string[] = [];
  if (result.warnings > 0) suffix.push(`${result.warnings} warning(s)`);
  if (result.errors > 0) suffix.push(`${result.errors} error(s)`);

  lines.push(`\nOverall: ${result.status}${suffix.length > 0 ? ` (${suffix.join(', ')})` : ''}`);
  return lines.join('\n');
}
