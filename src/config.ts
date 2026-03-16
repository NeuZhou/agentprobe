import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yaml';

export interface AgentProbeConfig {
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
  plugins?: string[];
}

const CONFIG_FILES = ['agentprobe.config.yaml', 'agentprobe.config.yml', '.agentproberc.yaml'];

/**
 * Load config from project root, searching up from cwd.
 */
export function loadConfig(startDir?: string): AgentProbeConfig {
  const dir = startDir ?? process.cwd();
  const configPath = findConfigFile(dir);
  if (!configPath) return {};

  const raw = fs.readFileSync(configPath, 'utf-8');
  return YAML.parse(raw) ?? {};
}

/**
 * Find config file searching up from startDir.
 */
function findConfigFile(startDir: string): string | null {
  let dir = startDir;
  while (true) {
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

/**
 * Get the resolved config directory.
 */
export function getConfigDir(startDir?: string): string {
  const dir = startDir ?? process.cwd();
  const configPath = findConfigFile(dir);
  return configPath ? path.dirname(configPath) : dir;
}
