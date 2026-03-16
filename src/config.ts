/**
 * Config — Full configuration loader with adapter, defaults, reporters, and security.
 *
 * Supports:
 *   - agentprobe.config.yaml / .yml / .agentproberc.yaml
 *   - Environment variable interpolation: ${VAR_NAME}
 *   - Duration strings: "30s" → 30000
 */

import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yaml';

// ── Interfaces ─────────────────────────────────────────────────────

export interface AdapterSection {
  type?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  [key: string]: any;
}

export interface DefaultsSection {
  timeout?: string | number;
  timeout_ms?: number;
  retries?: number;
  parallel?: number | boolean;
  format?: string;
  max_concurrency?: number;
}

export interface SecuritySection {
  enabled?: boolean;
  patterns?: string | string[];
}

export interface JudgeSection {
  model?: string;
  cache?: boolean;
}

export interface CoverageSection {
  tools?: string[];
}

export interface CiSection {
  fail_on_regression?: boolean;
  post_comment?: boolean;
}

export interface AgentProbeConfig {
  adapter?: AdapterSection;
  defaults?: DefaultsSection;
  reporters?: string[];
  judge?: JudgeSection;
  security?: SecuritySection;
  coverage?: CoverageSection;
  ci?: CiSection;
  plugins?: string[];
}

export interface ResolvedDefaults {
  timeout_ms: number;
  retries: number;
  parallel: number;
}

// ── Duration parser ────────────────────────────────────────────────

/**
 * Parse a duration string like "30s", "2m", "500ms" into milliseconds.
 * If already a number, return as-is.
 */
export function parseDuration(val: string | number | undefined, defaultMs: number = 30000): number {
  if (val === undefined || val === null) return defaultMs;
  if (typeof val === 'number') return val;
  const s = val.trim().toLowerCase();
  const match = s.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/);
  if (!match) return defaultMs;
  const num = parseFloat(match[1]);
  switch (match[2]) {
    case 'h': return num * 3600000;
    case 'm': return num * 60000;
    case 's': return num * 1000;
    case 'ms': return num;
    default: return num; // bare number = ms
  }
}

// ── Env interpolation ──────────────────────────────────────────────

/**
 * Interpolate ${VAR} references in a string using process.env.
 */
export function interpolateEnv(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_match, varName) => {
    return process.env[varName.trim()] ?? '';
  });
}

/**
 * Deep-interpolate env vars in an object.
 */
export function interpolateEnvDeep(obj: any): any {
  if (typeof obj === 'string') return interpolateEnv(obj);
  if (Array.isArray(obj)) return obj.map(interpolateEnvDeep);
  if (obj && typeof obj === 'object') {
    const result: any = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = interpolateEnvDeep(v);
    }
    return result;
  }
  return obj;
}

// ── Config file search ─────────────────────────────────────────────

const CONFIG_FILES = ['agentprobe.config.yaml', 'agentprobe.config.yml', '.agentproberc.yaml'];

/**
 * Find config file searching up from startDir.
 */
export function findConfigFile(startDir: string): string | null {
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

// ── Loaders ────────────────────────────────────────────────────────

/**
 * Load raw config from YAML file on disk.
 */
export function loadConfigRaw(startDir?: string): AgentProbeConfig {
  const dir = startDir ?? process.cwd();
  const configPath = findConfigFile(dir);
  if (!configPath) return {};
  const raw = fs.readFileSync(configPath, 'utf-8');
  return YAML.parse(raw) ?? {};
}

/**
 * Load config with environment variable interpolation.
 */
export function loadConfig(startDir?: string): AgentProbeConfig {
  const raw = loadConfigRaw(startDir);
  return interpolateEnvDeep(raw);
}

/**
 * Resolve defaults section into concrete values.
 */
export function resolveDefaults(cfg: AgentProbeConfig): ResolvedDefaults {
  const d = cfg.defaults ?? {};
  return {
    timeout_ms: d.timeout_ms ?? parseDuration(d.timeout, 30000),
    retries: d.retries ?? 0,
    parallel: typeof d.parallel === 'number' ? d.parallel : d.parallel ? 4 : 1,
  };
}

/**
 * Resolve security patterns from config.
 */
export function resolveSecurityPatterns(cfg: AgentProbeConfig): string[] {
  if (!cfg.security?.enabled && cfg.security?.enabled !== undefined) return [];
  const p = cfg.security?.patterns;
  if (!p) return [];
  return typeof p === 'string' ? [p] : p;
}

/**
 * Get the resolved config directory.
 */
export function getConfigDir(startDir?: string): string {
  const dir = startDir ?? process.cwd();
  const configPath = findConfigFile(dir);
  return configPath ? path.dirname(configPath) : dir;
}
