/**
 * Config File Support — Load .agentproberc.yml / agentprobe.config.ts
 *
 * Supports extended config format with adapter settings, reporter,
 * output directory, env file, and parallel/timeout options.
 */

import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yaml';

export interface AdapterConfig {
  model?: string;
  api_key?: string;
  base_url?: string;
  [key: string]: any;
}

export interface ProfileConfig {
  adapter?: string;
  model?: string;
  timeout_ms?: number;
  env?: Record<string, string>;
  tags?: string[];
  parallel?: boolean;
  max_concurrency?: number;
}

export interface ExtendedConfig {
  adapters?: {
    default?: string;
    [name: string]: AdapterConfig | string | undefined;
  };
  profiles?: Record<string, ProfileConfig>;
  parallel?: number;
  timeout_ms?: number;
  reporter?: string;
  output_dir?: string;
  env_file?: string;
  plugins?: string[];
  defaults?: {
    timeout_ms?: number;
    parallel?: boolean;
    format?: string;
  };
  judge?: {
    model?: string;
    cache?: boolean;
  };
  security?: {
    patterns?: string | string[];
  };
  coverage?: {
    tools?: string[];
  };
  ci?: {
    fail_on_regression?: boolean;
    post_comment?: boolean;
  };
  budgets?: {
    per_test?: number;
    per_suite?: number;
    per_day?: number;
    alert_threshold?: number;
  };
}

const CONFIG_FILES = [
  '.agentproberc.yml',
  '.agentproberc.yaml',
  'agentprobe.config.yml',
  'agentprobe.config.yaml',
  'agentprobe.config.ts',
  'agentprobe.config.js',
];

/**
 * Load extended config from project root.
 */
export function loadExtendedConfig(startDir?: string): ExtendedConfig {
  const dir = startDir ?? process.cwd();
  const configPath = findExtendedConfigFile(dir);
  if (!configPath) return {};

  if (configPath.endsWith('.ts') || configPath.endsWith('.js')) {
    return loadJsConfig(configPath);
  }

  const raw = fs.readFileSync(configPath, 'utf-8');
  return YAML.parse(raw) ?? {};
}

/**
 * Find config file searching up from startDir.
 */
export function findExtendedConfigFile(startDir: string): string | null {
  let dir = startDir;
  for (;;) {
    for (const name of CONFIG_FILES) {
      const fp = path.join(dir, name);
      if (fs.existsSync(fp)) return fp;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function loadJsConfig(configPath: string): ExtendedConfig {
  try {
    const mod = require(configPath);
    return mod.default ?? mod;
  } catch {
    return {};
  }
}

/**
 * Get the default adapter name from config.
 */
export function getDefaultAdapter(config: ExtendedConfig): string | undefined {
  return config.adapters?.default as string | undefined;
}

/**
 * Get adapter config by name.
 */
export function getAdapterConfig(config: ExtendedConfig, name: string): AdapterConfig | undefined {
  const val = config.adapters?.[name];
  if (!val || typeof val === 'string') return undefined;
  return val;
}

/**
 * Resolve the output directory from config.
 */
export function resolveOutputDir(config: ExtendedConfig, baseDir?: string): string {
  const dir = config.output_dir ?? './reports';
  if (path.isAbsolute(dir)) return dir;
  return path.join(baseDir ?? process.cwd(), dir);
}

/**
 * Load env file specified in config.
 */
export function loadEnvFromConfig(config: ExtendedConfig, baseDir?: string): void {
  if (!config.env_file) return;
  const envPath = path.isAbsolute(config.env_file)
    ? config.env_file
    : path.join(baseDir ?? process.cwd(), config.env_file);

  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

/**
 * Get a named profile from config.
 */
export function getProfile(config: ExtendedConfig, name: string): ProfileConfig | undefined {
  return config.profiles?.[name];
}

/**
 * List all available profile names.
 */
export function listProfiles(config: ExtendedConfig): string[] {
  return Object.keys(config.profiles ?? {});
}
