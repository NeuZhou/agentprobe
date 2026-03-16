/**
 * Test Execution Hooks — programmatic lifecycle hooks for test runs.
 */

import type { TestResult, SuiteResult } from './types';

export type BeforeAllHook = () => Promise<void> | void;
export type AfterAllHook = (results: SuiteResult) => Promise<void> | void;
export type BeforeEachHook = (testName: string) => Promise<void> | void;
export type AfterEachHook = (result: TestResult) => Promise<void> | void;
export type OnFailureHook = (testName: string, error: string) => Promise<void> | void;

export interface HooksRegistry {
  beforeAll: BeforeAllHook[];
  afterAll: AfterAllHook[];
  beforeEach: BeforeEachHook[];
  afterEach: AfterEachHook[];
  onFailure: OnFailureHook[];
}

export function createHooksRegistry(): HooksRegistry {
  return {
    beforeAll: [],
    afterAll: [],
    beforeEach: [],
    afterEach: [],
    onFailure: [],
  };
}

const globalRegistry: HooksRegistry = createHooksRegistry();

export function beforeAll(hook: BeforeAllHook): void {
  globalRegistry.beforeAll.push(hook);
}

export function afterAll(hook: AfterAllHook): void {
  globalRegistry.afterAll.push(hook);
}

export function beforeEach(hook: BeforeEachHook): void {
  globalRegistry.beforeEach.push(hook);
}

export function afterEach(hook: AfterEachHook): void {
  globalRegistry.afterEach.push(hook);
}

export function onFailure(hook: OnFailureHook): void {
  globalRegistry.onFailure.push(hook);
}

export function getGlobalHooks(): HooksRegistry {
  return globalRegistry;
}

export function clearHooks(): void {
  globalRegistry.beforeAll.length = 0;
  globalRegistry.afterAll.length = 0;
  globalRegistry.beforeEach.length = 0;
  globalRegistry.afterEach.length = 0;
  globalRegistry.onFailure.length = 0;
}

export async function runBeforeAll(registry: HooksRegistry): Promise<void> {
  for (const hook of registry.beforeAll) await hook();
}

export async function runAfterAll(registry: HooksRegistry, results: SuiteResult): Promise<void> {
  for (const hook of registry.afterAll) await hook(results);
}

export async function runBeforeEach(registry: HooksRegistry, testName: string): Promise<void> {
  for (const hook of registry.beforeEach) await hook(testName);
}

export async function runAfterEach(registry: HooksRegistry, result: TestResult): Promise<void> {
  for (const hook of registry.afterEach) await hook(result);
}

export async function runOnFailure(registry: HooksRegistry, testName: string, error: string): Promise<void> {
  for (const hook of registry.onFailure) await hook(testName, error);
}

/**
 * Parse hooks from YAML config format.
 */
export interface YamlHooksConfig {
  beforeAll?: { command: string };
  afterAll?: { command: string };
  beforeEach?: { command: string };
  afterEach?: { command: string };
  onFailure?: { command: string };
}

export function parseYamlHooks(config: YamlHooksConfig): { hookNames: string[] } {
  const hookNames: string[] = [];
  if (config.beforeAll) hookNames.push('beforeAll');
  if (config.afterAll) hookNames.push('afterAll');
  if (config.beforeEach) hookNames.push('beforeEach');
  if (config.afterEach) hookNames.push('afterEach');
  if (config.onFailure) hookNames.push('onFailure');
  return { hookNames };
}
