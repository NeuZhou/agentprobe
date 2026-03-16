/**
 * Environment Variable Support — resolve ${VAR} from process.env and .env files.
 */

import * as fs from 'fs';

/**
 * Parse a .env file into a key-value map.
 */
export function parseEnvFile(filePath: string): Record<string, string> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const env: Record<string, string> = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();

    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

/**
 * Resolve ${VAR} references in a string using process.env and optional extra env.
 */
export function resolveEnvVars(value: string, extraEnv?: Record<string, string>): string {
  return value.replace(/\$\{([^}]+)\}/g, (match, varName) => {
    const val = extraEnv?.[varName] ?? process.env[varName];
    if (val === undefined) return match; // Leave unresolved
    return val;
  });
}

/**
 * Resolve env vars in a Record<string, string>.
 */
export function resolveEnvRecord(
  env: Record<string, string>,
  extraEnv?: Record<string, string>,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    resolved[key] = resolveEnvVars(value, extraEnv);
  }
  return resolved;
}

/**
 * Apply env vars to process.env, returning backup for restore.
 */
export function applyEnv(env: Record<string, string>): Record<string, string | undefined> {
  const backup: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    backup[key] = process.env[key];
    process.env[key] = value;
  }
  return backup;
}

/**
 * Restore process.env from backup.
 */
export function restoreProcessEnv(backup: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(backup)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
