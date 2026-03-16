/**
 * Plugin Marketplace — List/install community plugins via npm.
 */

import { execSync } from 'child_process';

export interface MarketplacePlugin {
  name: string;
  description: string;
  version: string;
  date?: string;
  author?: string;
}

export interface MarketplaceSearchResult {
  plugins: MarketplacePlugin[];
  total: number;
}

/**
 * Search npm for agentprobe plugins.
 */
export function searchPlugins(query?: string): MarketplaceSearchResult {
  const searchTerm = query
    ? `agentprobe-plugin-${query}`
    : 'agentprobe-plugin-';

  try {
    const output = execSync(`npm search "${searchTerm}" --json 2>/dev/null`, {
      encoding: 'utf-8',
      timeout: 30000,
    });
    const results = JSON.parse(output);
    const plugins: MarketplacePlugin[] = results
      .filter((r: any) => r.name.startsWith('agentprobe-plugin-'))
      .map((r: any) => ({
        name: r.name,
        description: r.description ?? '',
        version: r.version ?? 'unknown',
        date: r.date,
        author: r.publisher?.username,
      }));

    return { plugins, total: plugins.length };
  } catch {
    return { plugins: [], total: 0 };
  }
}

/**
 * Install a plugin via npm.
 */
export function installPlugin(name: string, opts?: { global?: boolean }): { success: boolean; message: string } {
  const packageName = name.startsWith('agentprobe-plugin-') ? name : `agentprobe-plugin-${name}`;
  const flag = opts?.global ? '-g' : '--save';

  try {
    execSync(`npm install ${flag} ${packageName}`, {
      encoding: 'utf-8',
      timeout: 60000,
      stdio: 'pipe',
    });
    return { success: true, message: `Installed ${packageName}` };
  } catch (e: any) {
    return { success: false, message: `Failed to install ${packageName}: ${e.message}` };
  }
}

/**
 * Uninstall a plugin via npm.
 */
export function uninstallPlugin(name: string): { success: boolean; message: string } {
  const packageName = name.startsWith('agentprobe-plugin-') ? name : `agentprobe-plugin-${name}`;

  try {
    execSync(`npm uninstall ${packageName}`, {
      encoding: 'utf-8',
      timeout: 30000,
      stdio: 'pipe',
    });
    return { success: true, message: `Uninstalled ${packageName}` };
  } catch (e: any) {
    return { success: false, message: `Failed to uninstall ${packageName}: ${e.message}` };
  }
}

/**
 * Format marketplace results for terminal display.
 */
export function formatMarketplace(result: MarketplaceSearchResult): string {
  if (result.plugins.length === 0) {
    return '  No plugins found. Publish yours: agentprobe-plugin-*';
  }

  const lines: string[] = ['🔌 AgentProbe Plugins\n'];
  for (const p of result.plugins) {
    lines.push(`  ${p.name}@${p.version}`);
    if (p.description) lines.push(`    ${p.description}`);
    if (p.author) lines.push(`    by ${p.author}`);
    lines.push('');
  }
  lines.push(`  ${result.total} plugin(s) found`);
  lines.push('  Install: agentprobe plugin install <name>');
  return lines.join('\n');
}
