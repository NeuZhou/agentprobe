/**
 * Custom Assertion API — Let users define and register custom assertions.
 */

import type { AgentTrace, AssertionResult } from './types';

export type CustomAssertionFn = (
  trace: AgentTrace,
  params?: Record<string, any>,
) => { pass: boolean; message: string };

const registry = new Map<string, CustomAssertionFn>();

/**
 * Register a custom assertion by name.
 */
export function registerAssertion(name: string, fn: CustomAssertionFn): void {
  if (registry.has(name)) {
    throw new Error(`Custom assertion "${name}" is already registered`);
  }
  registry.set(name, fn);
}

/**
 * Unregister a custom assertion.
 */
export function unregisterAssertion(name: string): boolean {
  return registry.delete(name);
}

/**
 * Check if a custom assertion is registered.
 */
export function hasAssertion(name: string): boolean {
  return registry.has(name);
}

/**
 * List all registered custom assertion names.
 */
export function listAssertions(): string[] {
  return [...registry.keys()];
}

/**
 * Evaluate a custom assertion against a trace.
 */
export function evaluateCustomAssertion(
  name: string,
  trace: AgentTrace,
  params?: Record<string, any>,
): AssertionResult {
  const fn = registry.get(name);
  if (!fn) {
    return {
      name: `custom:${name}`,
      passed: false,
      message: `Custom assertion "${name}" is not registered`,
    };
  }

  try {
    const result = fn(trace, params);
    return {
      name: `custom:${name}`,
      passed: result.pass,
      message: result.message,
    };
  } catch (err: any) {
    return {
      name: `custom:${name}`,
      passed: false,
      message: `Custom assertion "${name}" threw: ${err.message}`,
    };
  }
}

/**
 * Clear all registered custom assertions.
 */
export function clearAssertions(): void {
  registry.clear();
}
