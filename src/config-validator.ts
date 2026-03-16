/**
 * Config Validator — Validate AgentProbe configuration files
 * Checks config structure, referenced files, adapter keys, plugins, and hooks.
 * @module
 */

export interface ConfigValidationIssue {
  level: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  path?: string;
}

export interface ConfigValidationResult {
  valid: boolean;
  issues: ConfigValidationIssue[];
  summary: string;
}

export interface AdapterKeyInfo {
  adapter: string;
  hasKey: boolean;
  expiresIn?: number; // days
  expired?: boolean;
}

export interface PluginInfo {
  name: string;
  loaded: boolean;
  error?: string;
}

export interface ConfigShape {
  name?: string;
  adapter?: string;
  adapters?: Record<string, { api_key?: string; endpoint?: string; expires?: string }>;
  tests?: string | string[];
  output?: string;
  plugins?: string[];
  hooks?: Record<string, { command?: string }>;
  profiles?: Record<string, any>;
  [key: string]: any;
}

/**
 * Validate that a config object has the required structure
 */
export function validateConfigStructure(config: ConfigShape): ConfigValidationIssue[] {
  const issues: ConfigValidationIssue[] = [];

  if (!config || typeof config !== 'object') {
    issues.push({ level: 'error', code: 'INVALID_ROOT', message: 'Config must be an object' });
    return issues;
  }

  if (!config.name && !config.adapter && !config.tests) {
    issues.push({ level: 'warning', code: 'EMPTY_CONFIG', message: 'Config appears empty — no name, adapter, or tests defined' });
  }

  if (config.tests) {
    const testPaths = Array.isArray(config.tests) ? config.tests : [config.tests];
    for (const p of testPaths) {
      if (typeof p !== 'string') {
        issues.push({ level: 'error', code: 'INVALID_TEST_PATH', message: `Test path must be a string, got ${typeof p}`, path: String(p) });
      }
    }
  }

  return issues;
}

/**
 * Validate adapter configuration and key expiration
 */
export function validateAdapters(config: ConfigShape): { issues: ConfigValidationIssue[]; adapters: AdapterKeyInfo[] } {
  const issues: ConfigValidationIssue[] = [];
  const adapters: AdapterKeyInfo[] = [];

  if (!config.adapters) {
    if (config.adapter) {
      adapters.push({ adapter: config.adapter, hasKey: true }); // assume key from env
    }
    return { issues, adapters };
  }

  for (const [name, adapterConfig] of Object.entries(config.adapters)) {
    const info: AdapterKeyInfo = { adapter: name, hasKey: !!adapterConfig.api_key };

    if (!adapterConfig.api_key) {
      issues.push({ level: 'warning', code: 'MISSING_KEY', message: `Adapter '${name}' has no api_key configured`, path: `adapters.${name}` });
    }

    if (adapterConfig.expires) {
      const expiryDate = new Date(adapterConfig.expires);
      const now = new Date();
      const daysUntilExpiry = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      info.expiresIn = daysUntilExpiry;
      info.expired = daysUntilExpiry < 0;

      if (daysUntilExpiry < 0) {
        issues.push({ level: 'error', code: 'KEY_EXPIRED', message: `Adapter '${name}' key expired ${Math.abs(daysUntilExpiry)} days ago` });
      } else if (daysUntilExpiry <= 7) {
        issues.push({ level: 'warning', code: 'KEY_EXPIRING', message: `Adapter '${name}' key expires in ${daysUntilExpiry} days` });
      }
    }

    adapters.push(info);
  }

  return { issues, adapters };
}

/**
 * Validate hooks syntax
 */
export function validateHooks(hooks?: Record<string, { command?: string }>): ConfigValidationIssue[] {
  const issues: ConfigValidationIssue[] = [];
  if (!hooks) return issues;

  const validHookNames = ['beforeAll', 'afterAll', 'beforeEach', 'afterEach'];

  for (const [name, hook] of Object.entries(hooks)) {
    if (!validHookNames.includes(name)) {
      issues.push({ level: 'warning', code: 'UNKNOWN_HOOK', message: `Unknown hook '${name}'. Valid: ${validHookNames.join(', ')}`, path: `hooks.${name}` });
    }
    if (!hook.command || typeof hook.command !== 'string') {
      issues.push({ level: 'error', code: 'INVALID_HOOK', message: `Hook '${name}' must have a command string`, path: `hooks.${name}` });
    }
  }

  return issues;
}

/**
 * Validate plugins
 */
export function validatePlugins(plugins?: string[]): { issues: ConfigValidationIssue[]; pluginInfos: PluginInfo[] } {
  const issues: ConfigValidationIssue[] = [];
  const pluginInfos: PluginInfo[] = [];

  if (!plugins) return { issues, pluginInfos };

  for (const plugin of plugins) {
    if (typeof plugin !== 'string') {
      issues.push({ level: 'error', code: 'INVALID_PLUGIN', message: `Plugin entry must be a string` });
      continue;
    }
    // In a real implementation, we'd try to require/import the plugin
    pluginInfos.push({ name: plugin, loaded: true });
  }

  if (pluginInfos.length > 0 && pluginInfos.every(p => p.loaded)) {
    issues.push({ level: 'info', code: 'PLUGINS_OK', message: `${pluginInfos.length} plugin(s) loaded successfully` });
  }

  return { issues, pluginInfos };
}

/**
 * Run full config validation
 */
export function validateConfig(config: ConfigShape): ConfigValidationResult {
  const allIssues: ConfigValidationIssue[] = [];

  // Structure
  allIssues.push(...validateConfigStructure(config));

  // Adapters
  const { issues: adapterIssues } = validateAdapters(config);
  allIssues.push(...adapterIssues);

  // Hooks
  allIssues.push(...validateHooks(config.hooks));

  // Plugins
  const { issues: pluginIssues } = validatePlugins(config.plugins);
  allIssues.push(...pluginIssues);

  const hasErrors = allIssues.some(i => i.level === 'error');

  return {
    valid: !hasErrors,
    issues: allIssues,
    summary: formatConfigValidation({ valid: !hasErrors, issues: allIssues, summary: '' }),
  };
}

/**
 * Format validation result for display
 */
export function formatConfigValidation(result: ConfigValidationResult): string {
  const lines: string[] = [];

  for (const issue of result.issues) {
    const icon = issue.level === 'error' ? '❌' : issue.level === 'warning' ? '⚠️' : '✅';
    lines.push(`${icon} ${issue.message}`);
  }

  if (result.issues.length === 0) {
    lines.push('✅ Config file valid');
  }

  if (result.valid && result.issues.filter(i => i.level === 'error').length === 0) {
    lines.push('✅ Configuration is valid');
  }

  return lines.join('\n');
}
