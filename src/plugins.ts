import * as fs from 'fs';
import * as path from 'path';
import type { AgentTrace, AssertionResult, TestResult, SuiteResult } from './types';

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

// ===== Enhanced Plugin Hooks =====

export interface PluginHooks {
  onTestStart?(test: { name: string; input: string }): void | Promise<void>;
  onTestComplete?(result: TestResult): void | Promise<void>;
  onSuiteStart?(suite: { name: string; total: number }): void | Promise<void>;
  onSuiteComplete?(results: SuiteResult): void | Promise<void>;
  onError?(error: Error, context: { test?: string }): void | Promise<void>;
}

export interface AgentProbePlugin {
  name: string;
  type?: 'reporter' | 'adapter' | 'assertion' | 'lifecycle';
  version?: string;
  assertions?: Record<string, AssertionHandler>;
  reporters?: Record<string, ReporterHandler>;
  adapters?: Record<string, AdapterHandler>;
  hooks?: PluginHooks;
}

const pluginAssertions: Record<string, AssertionHandler> = {};
const pluginReporters: Record<string, ReporterHandler> = {};
const pluginAdapters: Record<string, AdapterHandler> = {};
const registeredPlugins: Map<string, AgentProbePlugin> = new Map();
const pluginHooks: PluginHooks[] = [];

// ===== Hot-reload watchers =====
const watchers: Map<string, fs.FSWatcher> = new Map();

/**
 * Load and register a plugin.
 */
export function loadPlugin(pluginPath: string, baseDir?: string): AgentProbePlugin {
  const resolved = path.isAbsolute(pluginPath)
    ? pluginPath
    : path.join(baseDir ?? process.cwd(), pluginPath);
  if (!fs.existsSync(resolved)) throw new Error(`Plugin not found: ${resolved}`);

  // Clear require cache for hot-reload
  const absPath = path.resolve(resolved);
  delete require.cache[absPath];

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
  // Unregister previous version if exists
  if (registeredPlugins.has(plugin.name)) {
    unregisterPlugin(plugin.name);
  }

  registeredPlugins.set(plugin.name, plugin);

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
  if (plugin.hooks) {
    pluginHooks.push(plugin.hooks);
  }
}

/**
 * Unregister a plugin by name.
 */
export function unregisterPlugin(name: string): boolean {
  const plugin = registeredPlugins.get(name);
  if (!plugin) return false;

  if (plugin.assertions) {
    for (const key of Object.keys(plugin.assertions)) {
      delete pluginAssertions[key];
    }
  }
  if (plugin.reporters) {
    for (const key of Object.keys(plugin.reporters)) {
      delete pluginReporters[key];
    }
  }
  if (plugin.adapters) {
    for (const key of Object.keys(plugin.adapters)) {
      delete pluginAdapters[key];
    }
  }
  if (plugin.hooks) {
    const idx = pluginHooks.indexOf(plugin.hooks);
    if (idx >= 0) pluginHooks.splice(idx, 1);
  }

  registeredPlugins.delete(name);
  return true;
}

/**
 * Load all plugins from config.
 */
export function loadPlugins(pluginPaths: string[], baseDir?: string): AgentProbePlugin[] {
  return pluginPaths.map((p) => loadPlugin(p, baseDir));
}

/**
 * Enable hot-reload for a plugin file. Re-registers on change.
 */
export function watchPlugin(pluginPath: string, baseDir?: string): void {
  const resolved = path.isAbsolute(pluginPath)
    ? pluginPath
    : path.join(baseDir ?? process.cwd(), pluginPath);
  const absPath = path.resolve(resolved);

  if (watchers.has(absPath)) return; // already watching

  const watcher = fs.watch(absPath, { persistent: false }, (event) => {
    if (event === 'change') {
      try {
        loadPlugin(pluginPath, baseDir);
      } catch {
        // ignore reload errors
      }
    }
  });
  watchers.set(absPath, watcher);
}

/**
 * Stop watching a plugin file.
 */
export function unwatchPlugin(pluginPath: string, baseDir?: string): void {
  const resolved = path.isAbsolute(pluginPath)
    ? pluginPath
    : path.join(baseDir ?? process.cwd(), pluginPath);
  const absPath = path.resolve(resolved);
  const watcher = watchers.get(absPath);
  if (watcher) {
    watcher.close();
    watchers.delete(absPath);
  }
}

/**
 * Stop all file watchers.
 */
export function unwatchAll(): void {
  for (const [, watcher] of watchers) {
    watcher.close();
  }
  watchers.clear();
}

// ===== Hook Runners =====

export async function runPluginHook<K extends keyof PluginHooks>(
  hook: K,
  ...args: Parameters<NonNullable<PluginHooks[K]>>
): Promise<void> {
  for (const h of pluginHooks) {
    const fn = h[hook] as ((...a: any[]) => void | Promise<void>) | undefined;
    if (fn) {
      try {
        await fn(...args);
      } catch {
        // plugin hook errors should not break the runner
      }
    }
  }
}

// ===== Querying =====

/**
 * Run a plugin assertion.
 */
export function runPluginAssertion(
  name: string,
  trace: AgentTrace,
  value: any,
): AssertionResult | null {
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

/**
 * Get all registered plugins.
 */
export function getRegisteredPlugins(): AgentProbePlugin[] {
  return [...registeredPlugins.values()];
}

/**
 * Get a registered plugin by name.
 */
export function getPlugin(name: string): AgentProbePlugin | undefined {
  return registeredPlugins.get(name);
}

// ===== Plugin Manager (OOP wrapper) =====

export class PluginManager {
  private baseDir?: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir;
  }

  register(plugin: AgentProbePlugin): void {
    registerPlugin(plugin);
  }

  loadFromFile(pluginPath: string): AgentProbePlugin {
    return loadPlugin(pluginPath, this.baseDir);
  }

  loadFromPackage(name: string): AgentProbePlugin {
    // npm packages follow the convention agentprobe-plugin-*
    const packageName = name.startsWith('agentprobe-plugin-') ? name : `agentprobe-plugin-${name}`;
    try {
      const mod = require(packageName);
      const plugin: AgentProbePlugin = mod.default ?? mod;
      if (!plugin.name) plugin.name = name;
      this.register(plugin);
      return plugin;
    } catch (err: any) {
      throw new Error(`Failed to load plugin package "${packageName}": ${err.message}`);
    }
  }

  unregister(name: string): boolean {
    return unregisterPlugin(name);
  }

  get(name: string): AgentProbePlugin | undefined {
    return getPlugin(name);
  }

  getAll(): AgentProbePlugin[] {
    return getRegisteredPlugins();
  }

  getHooks(hookName: keyof PluginHooks): Function[] {
    return pluginHooks
      .map((h) => (h as any)[hookName])
      .filter((fn): fn is Function => typeof fn === 'function');
  }

  clear(): void {
    clearAllPlugins();
  }
}

/**
 * Clear all registered plugins and watchers (for testing).
 */
export function clearAllPlugins(): void {
  registeredPlugins.clear();
  Object.keys(pluginAssertions).forEach(k => delete pluginAssertions[k]);
  Object.keys(pluginReporters).forEach(k => delete pluginReporters[k]);
  Object.keys(pluginAdapters).forEach(k => delete pluginAdapters[k]);
  pluginHooks.length = 0;
  unwatchAll();
}
