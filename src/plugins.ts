import * as fs from 'fs';
import * as path from 'path';
import type { AgentTrace, AssertionResult } from './types';
import type { SuiteResult } from './types';
import type { TraceAdapter } from './adapters';

export interface AssertionHandler {
  (trace: AgentTrace, value: any): AssertionResult;
}

export interface ReporterHandler {
  (result: SuiteResult): string;
}

export interface AdapterHandler {
  name: string;
  detect(input: any): boolean;
  convert(input: any): AgentTrace;
}

export interface AgentProbePlugin {
  name: string;
  assertions?: Record<string, AssertionHandler>;
  reporters?: Record<string, ReporterHandler>;
  adapters?: Record<string, AdapterHandler>;
}

const pluginAssertions: Record<string, AssertionHandler> = {};
const pluginReporters: Record<string, ReporterHandler> = {};
const pluginAdapters: Record<string, AdapterHandler> = {};

/**
 * Load and register a plugin.
 */
export function loadPlugin(pluginPath: string, baseDir?: string): AgentProbePlugin {
  const resolved = path.isAbsolute(pluginPath) ? pluginPath : path.join(baseDir ?? process.cwd(), pluginPath);
  if (!fs.existsSync(resolved)) throw new Error(`Plugin not found: ${resolved}`);

  const mod = require(resolved);
  const plugin: AgentProbePlugin = mod.default ?? mod;

  if (!plugin.name) throw new Error(`Plugin at ${resolved} missing 'name'`);

  registerPlugin(plugin);
  return plugin;
}

/**
 * Register a plugin's extensions.
 */
export function registerPlugin(plugin: AgentProbePlugin): void {
  if (plugin.assertions) {
    for (const [name, handler] of Object.entries(plugin.assertions)) {
      pluginAssertions[name] = handler;
    }
  }
  if (plugin.reporters) {
    for (const [name, handler] of Object.entries(plugin.reporters)) {
      pluginReporters[name] = handler;
    }
  }
  if (plugin.adapters) {
    for (const [name, handler] of Object.entries(plugin.adapters)) {
      pluginAdapters[name] = handler;
    }
  }
}

/**
 * Load all plugins from config.
 */
export function loadPlugins(pluginPaths: string[], baseDir?: string): AgentProbePlugin[] {
  return pluginPaths.map(p => loadPlugin(p, baseDir));
}

/**
 * Run a plugin assertion.
 */
export function runPluginAssertion(name: string, trace: AgentTrace, value: any): AssertionResult | null {
  const handler = pluginAssertions[name];
  if (!handler) return null;
  return handler(trace, value);
}

/**
 * Get a plugin reporter.
 */
export function getPluginReporter(name: string): ReporterHandler | null {
  return pluginReporters[name] ?? null;
}

/**
 * Get all registered plugin assertion names.
 */
export function getPluginAssertionNames(): string[] {
  return Object.keys(pluginAssertions);
}

/**
 * Get all registered plugin reporter names.
 */
export function getPluginReporterNames(): string[] {
  return Object.keys(pluginReporters);
}
