/**
 * Environment Profiles — Load and manage named profiles for different environments.
 *
 * Profiles define adapter, model, budget, env vars, and other settings
 * for dev/staging/production environments.
 */

import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yaml';

// ===== Types =====

export interface EnvironmentProfile {
  adapter?: string;
  model?: string;
  budget?: number;
  timeout_ms?: number;
  parallel?: boolean;
  max_concurrency?: number;
  env?: Record<string, string>;
  tags?: string[];
  plugins?: string[];
}

export interface ProfilesConfig {
  profiles: Record<string, EnvironmentProfile>;
  default?: string;
}

// ===== Profile File Locations =====

const PROFILE_FILES = [
  '.agentprobe/profiles.yml',
  '.agentprobe/profiles.yaml',
  '.agentproberc.yml',
  '.agentproberc.yaml',
];

// ===== Loading =====

export function findProfilesFile(startDir?: string): string | null {
  const dir = startDir ?? process.cwd();
  for (const f of PROFILE_FILES) {
    const fp = path.join(dir, f);
    if (fs.existsSync(fp)) return fp;
  }
  return null;
}

export function loadProfiles(filePath: string): ProfilesConfig {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Profiles file not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = YAML.parse(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid profiles file: expected YAML object');
  }

  // Support both top-level "profiles:" key and raw profile map
  const profiles = parsed.profiles ?? parsed;
  const defaultProfile = parsed.default;

  // Validate each profile
  const validated: Record<string, EnvironmentProfile> = {};
  for (const [name, raw] of Object.entries(profiles)) {
    if (name === 'default') continue;
    if (typeof raw !== 'object' || raw === null) continue;
    validated[name] = parseProfile(raw as any);
  }

  return { profiles: validated, default: defaultProfile };
}

export function parseProfile(raw: any): EnvironmentProfile {
  return {
    adapter: raw.adapter,
    model: raw.model,
    budget: typeof raw.budget === 'number' ? raw.budget : undefined,
    timeout_ms: raw.timeout_ms,
    parallel: raw.parallel,
    max_concurrency: raw.max_concurrency,
    env: raw.env,
    tags: raw.tags,
    plugins: raw.plugins,
  };
}

export function resolveProfile(
  config: ProfilesConfig,
  name?: string,
): EnvironmentProfile | undefined {
  const profileName = name ?? config.default;
  if (!profileName) return undefined;
  return config.profiles[profileName];
}

// ===== Profile Application =====

export function applyProfile(profile: EnvironmentProfile): void {
  if (profile.adapter) process.env.AGENTPROBE_ADAPTER = profile.adapter;
  if (profile.model) process.env.AGENTPROBE_MODEL = profile.model;
  if (profile.timeout_ms) process.env.AGENTPROBE_TIMEOUT_MS = String(profile.timeout_ms);
  if (profile.budget !== undefined) process.env.AGENTPROBE_BUDGET = String(profile.budget);
  if (profile.env) {
    for (const [key, value] of Object.entries(profile.env)) {
      process.env[key] = value;
    }
  }
}

// ===== Validation =====

export function validateProfile(profile: EnvironmentProfile): string[] {
  const errors: string[] = [];
  if (profile.budget !== undefined && profile.budget < 0) {
    errors.push('Budget cannot be negative');
  }
  if (profile.timeout_ms !== undefined && profile.timeout_ms < 0) {
    errors.push('Timeout cannot be negative');
  }
  if (profile.max_concurrency !== undefined && profile.max_concurrency < 1) {
    errors.push('Max concurrency must be at least 1');
  }
  return errors;
}

export function validateProfiles(config: ProfilesConfig): Record<string, string[]> {
  const results: Record<string, string[]> = {};
  for (const [name, profile] of Object.entries(config.profiles)) {
    const errors = validateProfile(profile);
    if (errors.length > 0) results[name] = errors;
  }
  if (config.default && !config.profiles[config.default]) {
    results['_config'] = [`Default profile "${config.default}" not found`];
  }
  return results;
}

// ===== Formatting =====

export function formatProfiles(config: ProfilesConfig): string {
  const lines: string[] = ['', '  📋 Environment Profiles'];

  for (const [name, profile] of Object.entries(config.profiles)) {
    const isDefault = config.default === name;
    const marker = isDefault ? ' (default)' : '';
    lines.push(`     ${name}${marker}:`);
    if (profile.adapter) lines.push(`       adapter: ${profile.adapter}`);
    if (profile.model) lines.push(`       model: ${profile.model}`);
    if (profile.budget !== undefined) lines.push(`       budget: $${profile.budget.toFixed(2)}`);
    if (profile.timeout_ms) lines.push(`       timeout: ${profile.timeout_ms}ms`);
  }

  return lines.join('\n');
}

export function listProfileNames(config: ProfilesConfig): string[] {
  return Object.keys(config.profiles);
}

// ===== Scaffold =====

export function scaffoldProfiles(): string {
  return `# .agentprobe/profiles.yml
profiles:
  dev:
    adapter: ollama
    model: llama3
    budget: 0
    timeout_ms: 30000
  staging:
    adapter: openai
    model: gpt-3.5-turbo
    budget: 5.00
    timeout_ms: 60000
  production:
    adapter: openai
    model: gpt-4
    budget: 50.00
    timeout_ms: 120000
default: dev
`;
}
