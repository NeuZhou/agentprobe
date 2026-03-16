/**
 * Fixtures System - Pre-configured test environments
 */

import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yaml';
import { MockToolkit } from './mocks';

export interface FixtureToolConfig {
  name: string;
  mock?: any;
  mock_file?: string;
  mock_sequence?: any[];
  mock_error?: string;
}

export interface FixtureConfig {
  name: string;
  model?: string;
  tools?: FixtureToolConfig[];
  system_prompt?: string;
  env?: Record<string, string>;
}

/**
 * Load a fixture from a YAML file.
 */
export function loadFixture(fixturePath: string): FixtureConfig {
  const raw = fs.readFileSync(fixturePath, 'utf-8');
  return YAML.parse(raw) as FixtureConfig;
}

/**
 * Apply a fixture's tool mocks to a MockToolkit.
 */
export function applyFixtureMocks(
  fixture: FixtureConfig,
  toolkit: MockToolkit,
  basePath: string,
): void {
  if (!fixture.tools) return;

  for (const tool of fixture.tools) {
    if (tool.mock_error) {
      toolkit.mockError(tool.name, tool.mock_error);
    } else if (tool.mock_sequence) {
      toolkit.mockSequence(tool.name, tool.mock_sequence);
    } else if (tool.mock_file) {
      const filePath = path.isAbsolute(tool.mock_file)
        ? tool.mock_file
        : path.join(basePath, tool.mock_file);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      toolkit.mock(tool.name, () => data);
    } else if (tool.mock !== undefined) {
      const response = tool.mock;
      toolkit.mock(tool.name, () => response);
    }
  }
}

/**
 * Apply fixture env vars (set process.env).
 */
export function applyFixtureEnv(fixture: FixtureConfig): Record<string, string | undefined> {
  const original: Record<string, string | undefined> = {};
  if (!fixture.env) return original;

  for (const [key, value] of Object.entries(fixture.env)) {
    original[key] = process.env[key];
    process.env[key] = value;
  }
  return original;
}

/**
 * Restore env vars to original values.
 */
export function restoreEnv(original: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

// ─── Fixture Manager (v4.5.0) ────────────────────────────────────────

export interface FixtureDefinition {
  name: string;
  setup: () => any;
  teardown?: (ctx: any) => void;
}

/**
 * Reusable test setup/teardown manager.
 *
 * Built-in fixtures: mockLLM, mockTools, traceCapture, costTracker
 */
export class FixtureManager {
  private fixtures = new Map<string, FixtureDefinition>();
  private activeContexts = new Map<string, any>();

  constructor() {
    this.registerBuiltins();
  }

  /**
   * Define a named fixture with setup and optional teardown.
   */
  define(name: string, setup: () => any, teardown?: (ctx: any) => void): void {
    this.fixtures.set(name, { name, setup, teardown });
  }

  /**
   * Use (activate) a fixture — runs setup, returns context.
   */
  use(name: string): any {
    const fixture = this.fixtures.get(name);
    if (!fixture) {
      throw new Error(`Fixture "${name}" not found. Available: ${this.list().join(', ')}`);
    }
    const ctx = fixture.setup();
    this.activeContexts.set(name, ctx);
    return ctx;
  }

  /**
   * Teardown a specific fixture.
   */
  teardown(name: string): void {
    const fixture = this.fixtures.get(name);
    const ctx = this.activeContexts.get(name);
    if (fixture?.teardown && ctx !== undefined) {
      fixture.teardown(ctx);
    }
    this.activeContexts.delete(name);
  }

  /**
   * Teardown all active fixtures.
   */
  teardownAll(): void {
    for (const name of this.activeContexts.keys()) {
      this.teardown(name);
    }
  }

  /**
   * Check if a fixture is defined.
   */
  has(name: string): boolean {
    return this.fixtures.has(name);
  }

  /**
   * List all defined fixture names.
   */
  list(): string[] {
    return Array.from(this.fixtures.keys());
  }

  /**
   * Get currently active fixture names.
   */
  active(): string[] {
    return Array.from(this.activeContexts.keys());
  }

  private registerBuiltins(): void {
    // mockLLM — provides a mock LLM that returns canned responses
    this.define('mockLLM', () => {
      const responses: string[] = [];
      return {
        responses,
        addResponse(text: string) { responses.push(text); },
        getResponse() { return responses.shift() ?? 'Mock LLM response'; },
      };
    });

    // mockTools — provides a tool mock registry
    this.define('mockTools', () => {
      const mocks = new Map<string, any>();
      return {
        mock(name: string, response: any) { mocks.set(name, response); },
        call(name: string) { return mocks.get(name) ?? { error: 'Not mocked' }; },
        mocks,
      };
    });

    // traceCapture — captures trace steps
    this.define('traceCapture', () => {
      const steps: any[] = [];
      return {
        steps,
        capture(step: any) { steps.push(step); },
        clear() { steps.length = 0; },
        count() { return steps.length; },
      };
    });

    // costTracker — tracks token usage and cost
    this.define('costTracker', () => {
      let totalInput = 0;
      let totalOutput = 0;
      let totalCost = 0;
      return {
        record(input: number, output: number, cost: number) {
          totalInput += input;
          totalOutput += output;
          totalCost += cost;
        },
        get inputTokens() { return totalInput; },
        get outputTokens() { return totalOutput; },
        get cost() { return totalCost; },
        reset() { totalInput = 0; totalOutput = 0; totalCost = 0; },
      };
    });
  }
}
