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
