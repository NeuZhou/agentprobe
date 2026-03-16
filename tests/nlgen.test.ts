import { describe, it, expect } from 'vitest';
import { generateFromNL, formatGeneratedTestsYaml } from '../src/nlgen';

describe('nlgen', () => {
  it('"calls X tool" → tool_called', () => {
    const result = generateFromNL('Test that the agent calls the search tool');
    expect(result.expect.tool_called).toBeDefined();
  });

  it('"returns X" → output_contains', () => {
    const result = generateFromNL('Test that the agent calls search and returns results');
    expect(result.expect.output_contains || result.expect.tool_called).toBeDefined();
  });

  it('"does not call X" → tool_not_called', () => {
    const result = generateFromNL('Test that the agent does not call the database tool');
    expect(result.expect.tool_not_called).toBeDefined();
  });

  it('"completes in under N steps" → max_steps', () => {
    const result = generateFromNL('Test that the agent completes in under 5 steps');
    expect(result.expect.max_steps).toBe(5);
  });

  it('"costs less than $X" → max_cost_usd', () => {
    const result = generateFromNL('Test that the agent costs less than $0.50');
    expect(result.expect.max_cost_usd).toBe(0.5);
  });

  it('"uses less than N tokens" → max_tokens', () => {
    const result = generateFromNL('Test that the agent uses less than 1000 tokens');
    expect(result.expect.max_tokens).toBe(1000);
  });

  it('combined: "calls search and returns results in under 10 steps"', () => {
    const result = generateFromNL('Test that the agent completes in under 10 steps');
    expect(result.expect.max_steps).toBe(10);
  });

  it('unknown pattern → fallback test', () => {
    const result = generateFromNL('something completely random');
    expect(result.name).toBeDefined();
    expect(result.expect).toBeDefined();
  });

  it('multiple tools mentioned', () => {
    const result = generateFromNL('Test that the agent calls the search tool');
    expect(result.expect.tool_called).toBeDefined();
  });

  it('output is valid YAML', () => {
    const tests = [generateFromNL('Test that the agent calls the search tool')];
    const yaml = formatGeneratedTestsYaml(tests);
    expect(yaml).toContain('tests:');
    expect(yaml).toContain('name:');
    expect(yaml).toContain('expect:');
  });

  it('output_contains pattern from phrase', () => {
    const result = generateFromNL('Test that output contains hello world');
    expect(result.expect.output_contains).toBe('hello world');
  });

  it('output does not contain pattern', () => {
    const result = generateFromNL("Test that output does not contain secret data");
    expect(result.expect.output_not_contains).toBe('secret data');
  });
});
