/**
 * Plugin Registry — Discover, install, and manage AgentProbe plugins.
 *
 * Provides a curated registry of official and community plugins
 * with install/uninstall capabilities.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface PluginEntry {
  name: string;
  description: string;
  version: string;
  author: string;
  category: 'reporter' | 'adapter' | 'assertion' | 'notifier' | 'exporter';
  npmPackage: string;
  official: boolean;
  downloads?: number;
}

export interface PluginRegistryConfig {
  registryUrl?: string;
  cacheDir?: string;
}

/** Built-in plugin registry (curated list). */
const BUILTIN_REGISTRY: PluginEntry[] = [
  {
    name: '@agentprobe/slack-notifier',
    description: 'Send test results to Slack channels',
    version: '1.0.0',
    author: 'agentprobe',
    category: 'notifier',
    npmPackage: '@agentprobe/slack-notifier',
    official: true,
    downloads: 1250,
  },
  {
    name: '@agentprobe/html-reporter',
    description: 'Generate custom HTML test reports with charts',
    version: '1.2.0',
    author: 'agentprobe',
    category: 'reporter',
    npmPackage: '@agentprobe/html-reporter',
    official: true,
    downloads: 980,
  },
  {
    name: '@agentprobe/otel-exporter',
    description: 'Export traces and metrics to OpenTelemetry',
    version: '1.1.0',
    author: 'agentprobe',
    category: 'exporter',
    npmPackage: '@agentprobe/otel-exporter',
    official: true,
    downloads: 720,
  },
  {
    name: '@agentprobe/discord-notifier',
    description: 'Post test results to Discord webhooks',
    version: '0.9.0',
    author: 'community',
    category: 'notifier',
    npmPackage: '@agentprobe/discord-notifier',
    official: false,
    downloads: 340,
  },
  {
    name: '@agentprobe/csv-reporter',
    description: 'Export results as CSV for spreadsheet analysis',
    version: '1.0.0',
    author: 'community',
    category: 'reporter',
    npmPackage: '@agentprobe/csv-reporter',
    official: false,
    downloads: 210,
  },
  {
    name: '@agentprobe/langchain-adapter',
    description: 'Adapter for LangChain agent traces',
    version: '1.0.0',
    author: 'agentprobe',
    category: 'adapter',
    npmPackage: '@agentprobe/langchain-adapter',
    official: true,
    downloads: 890,
  },
  {
    name: '@agentprobe/teams-notifier',
    description: 'Send test results to Microsoft Teams',
    version: '0.8.0',
    author: 'community',
    category: 'notifier',
    npmPackage: '@agentprobe/teams-notifier',
    official: false,
    downloads: 150,
  },
  {
    name: '@agentprobe/pdf-reporter',
    description: 'Generate PDF test reports',
    version: '0.7.0',
    author: 'community',
    category: 'reporter',
    npmPackage: '@agentprobe/pdf-reporter',
    official: false,
    downloads: 95,
  },
];

/**
 * List all available plugins from the registry.
 */
export function listPlugins(options?: {
  category?: string;
  official?: boolean;
  query?: string;
}): PluginEntry[] {
  let results = [...BUILTIN_REGISTRY];

  if (options?.category) {
    results = results.filter(p => p.category === options.category);
  }
  if (options?.official !== undefined) {
    results = results.filter(p => p.official === options.official);
  }
  if (options?.query) {
    const q = options.query.toLowerCase();
    results = results.filter(
      p =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q),
    );
  }

  return results.sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0));
}

/**
 * Get a specific plugin entry by name.
 */
export function getPluginEntry(name: string): PluginEntry | undefined {
  return BUILTIN_REGISTRY.find(p => p.name === name);
}

/**
 * Check which plugins are installed locally.
 */
export function getInstalledPlugins(projectDir: string = '.'): string[] {
  const pkgPath = path.join(projectDir, 'package.json');
  if (!fs.existsSync(pkgPath)) return [];

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return BUILTIN_REGISTRY
      .filter(p => deps[p.npmPackage])
      .map(p => p.name);
  } catch {
    return [];
  }
}

/**
 * Generate install command for a plugin.
 */
export function getInstallCommand(
  pluginName: string,
  packageManager: 'npm' | 'yarn' | 'pnpm' = 'npm',
): string | null {
  const entry = getPluginEntry(pluginName);
  if (!entry) return null;

  switch (packageManager) {
    case 'npm':
      return `npm install ${entry.npmPackage}`;
    case 'yarn':
      return `yarn add ${entry.npmPackage}`;
    case 'pnpm':
      return `pnpm add ${entry.npmPackage}`;
  }
}

/**
 * Format plugin list for display.
 */
export function formatPluginList(plugins: PluginEntry[]): string {
  const lines: string[] = [];
  lines.push(`\n📦 Available Plugins (${plugins.length}):\n`);

  for (const p of plugins) {
    const badge = p.official ? '✅' : '🔌';
    const dl = p.downloads ? ` (${p.downloads} downloads)` : '';
    lines.push(`  ${badge} ${p.name}${dl}`);
    lines.push(`     ${p.description}`);
    lines.push(`     v${p.version} · ${p.category} · by ${p.author}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format single plugin details.
 */
export function formatPluginDetail(entry: PluginEntry): string {
  const lines: string[] = [];
  const badge = entry.official ? '✅ Official' : '🔌 Community';
  lines.push(`\n${badge}: ${entry.name} v${entry.version}`);
  lines.push(`  ${entry.description}`);
  lines.push(`  Category: ${entry.category}`);
  lines.push(`  Author: ${entry.author}`);
  lines.push(`  Package: ${entry.npmPackage}`);
  if (entry.downloads) lines.push(`  Downloads: ${entry.downloads}`);
  lines.push(`\n  Install: npm install ${entry.npmPackage}`);
  return lines.join('\n');
}
