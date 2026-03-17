/**
 * Round 19 Tests — v1.9.0
 * VSCode extension scaffold, GitHub Action, deterministic replay,
 * OpenAPI test generation, trace visualization, and integration tests.
 */

import { describe, it, expect } from 'vitest';
import {
  deterministicReplay,
  formatDeterministicReplay,
  replayTrace,
  formatReplayResult,
} from '../src/replay';
import type { DeterministicReplayResult, VerificationMismatch } from '../src/replay';
import {
  loadOpenAPISpec,
  generateFromOpenAPI,
  formatOpenAPITests,
} from '../src/openapi';
import type { OpenAPISpec, OpenAPITestSuite } from '../src/openapi';
import {
  traceToMermaid,
  traceToText,
  traceToHtml,
  visualizeTrace,
} from '../src/viz';
import type { VizFormat } from '../src/viz';
import type { AgentTrace } from '../src/types';
import * as fs from 'fs';
import * as path from 'path';

// ===== Test Fixtures =====

function makeTrace(steps: AgentTrace['steps'] = []): AgentTrace {
  return {
    id: 'test-trace-001',
    timestamp: '2026-03-16T00:00:00Z',
    steps,
    metadata: {},
  };
}

function makeToolCallStep(name: string, args: Record<string, any> = {}, durationMs = 100) {
  return {
    type: 'tool_call' as const,
    timestamp: new Date().toISOString(),
    data: { tool_name: name, tool_args: args },
    duration_ms: durationMs,
  };
}

function makeToolResultStep(name: string, result: any = 'ok') {
  return {
    type: 'tool_result' as const,
    timestamp: new Date().toISOString(),
    data: { tool_name: name, tool_result: result },
  };
}

function makeLLMStep(userMsg: string, model = 'gpt-4') {
  return {
    type: 'llm_call' as const,
    timestamp: new Date().toISOString(),
    data: {
      model,
      messages: [{ role: 'user' as const, content: userMsg }],
      tokens: { input: 50, output: 100 },
    },
    duration_ms: 500,
  };
}

function makeOutputStep(content: string) {
  return {
    type: 'output' as const,
    timestamp: new Date().toISOString(),
    data: { content },
  };
}

function makeThoughtStep(content: string) {
  return {
    type: 'thought' as const,
    timestamp: new Date().toISOString(),
    data: { content },
  };
}

const sampleOpenAPI: OpenAPISpec = {
  openapi: '3.0.0',
  info: { title: 'Pet Store', version: '1.0.0', description: 'A sample pet store' },
  paths: {
    '/pets': {
      get: {
        operationId: 'listPets',
        summary: 'List all pets',
        parameters: [
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer', default: 10 } },
        ],
        responses: { '200': { description: 'A list of pets' } },
        tags: ['pets'],
      },
      post: {
        operationId: 'createPet',
        summary: 'Create a pet',
        parameters: [
          { name: 'name', in: 'query', required: true, schema: { type: 'string' } },
        ],
        requestBody: { required: true, content: { 'application/json': { schema: {} } } },
        responses: { '201': { description: 'Pet created' } },
        tags: ['pets'],
      },
    },
    '/pets/{petId}': {
      get: {
        operationId: 'getPet',
        summary: 'Get a pet by ID',
        parameters: [
          { name: 'petId', in: 'path', required: true, schema: { type: 'integer', example: 42 } },
        ],
        responses: { '200': { description: 'A single pet' } },
        tags: ['pets'],
      },
      delete: {
        operationId: 'deletePet',
        summary: 'Delete a pet',
        parameters: [
          { name: 'petId', in: 'path', required: true, schema: { type: 'integer', example: 1 } },
        ],
        responses: { '204': { description: 'Pet deleted' } },
        tags: ['pets'],
      },
    },
  },
};

// ===== Deterministic Replay Tests =====

describe('Deterministic Replay', () => {
  it('should pass when traces match exactly', () => {
    const steps = [
      makeToolCallStep('search', { query: 'test' }),
      makeToolResultStep('search', { results: [] }),
    ];
    const trace = makeTrace(steps);
    const result = deterministicReplay(trace, makeTrace(steps));
    expect(result.passed).toBe(true);
    expect(result.mismatches).toHaveLength(0);
    expect(result.verifiedSteps).toBe(1);
  });

  it('should fail when tool names differ', () => {
    const expected = makeTrace([makeToolCallStep('search', { q: 'a' })]);
    const actual = makeTrace([makeToolCallStep('lookup', { q: 'a' })]);
    const result = deterministicReplay(expected, actual);
    expect(result.passed).toBe(false);
    expect(result.mismatches.some(m => m.field === 'tool_name')).toBe(true);
  });

  it('should fail when tool args differ', () => {
    const expected = makeTrace([makeToolCallStep('search', { query: 'cats' })]);
    const actual = makeTrace([makeToolCallStep('search', { query: 'dogs' })]);
    const result = deterministicReplay(expected, actual);
    expect(result.passed).toBe(false);
    expect(result.mismatches.some(m => m.field === 'tool_args')).toBe(true);
  });

  it('should detect missing tool calls', () => {
    const expected = makeTrace([
      makeToolCallStep('search', { q: 'a' }),
      makeToolCallStep('fetch', { url: 'x' }),
    ]);
    const actual = makeTrace([makeToolCallStep('search', { q: 'a' })]);
    const result = deterministicReplay(expected, actual);
    expect(result.passed).toBe(false);
    expect(result.mismatches.some(m => m.field === 'tool_call_count')).toBe(true);
  });

  it('should detect extra tool calls', () => {
    const expected = makeTrace([makeToolCallStep('search', { q: 'a' })]);
    const actual = makeTrace([
      makeToolCallStep('search', { q: 'a' }),
      makeToolCallStep('extra', {}),
    ]);
    const result = deterministicReplay(expected, actual);
    expect(result.passed).toBe(false);
  });

  it('should handle empty traces', () => {
    const result = deterministicReplay(makeTrace([]), makeTrace([]));
    expect(result.passed).toBe(true);
    expect(result.verifiedSteps).toBe(0);
  });

  it('should ignore non-tool-call steps for verification', () => {
    const expected = makeTrace([
      makeLLMStep('hello'),
      makeToolCallStep('search', { q: 'test' }),
      makeOutputStep('result'),
    ]);
    const actual = makeTrace([
      makeLLMStep('different prompt'),
      makeToolCallStep('search', { q: 'test' }),
      makeOutputStep('different output'),
    ]);
    const result = deterministicReplay(expected, actual);
    expect(result.passed).toBe(true);
  });

  it('should format passing result', () => {
    const result = deterministicReplay(makeTrace([]), makeTrace([]));
    const fmt = formatDeterministicReplay(result);
    expect(fmt).toContain('PASSED');
  });

  it('should format failing result with details', () => {
    const expected = makeTrace([makeToolCallStep('a', {})]);
    const actual = makeTrace([makeToolCallStep('b', {})]);
    const result = deterministicReplay(expected, actual);
    const fmt = formatDeterministicReplay(result);
    expect(fmt).toContain('FAILED');
    expect(fmt).toContain('tool_name');
  });
});

// ===== OpenAPI Test Generation =====

describe('OpenAPI Test Generation', () => {
  it('should generate tests from OpenAPI spec', () => {
    const suite = generateFromOpenAPI(sampleOpenAPI, 'pet-agent');
    expect(suite.name).toContain('Pet Store');
    expect(suite.tests.length).toBeGreaterThan(0);
    expect(suite.agent).toBe('pet-agent');
  });

  it('should generate tests for each HTTP method', () => {
    const suite = generateFromOpenAPI(sampleOpenAPI, 'pet-agent');
    const methods = suite.tests.map(t => t.tags).flat();
    expect(methods).toContain('get');
    expect(methods).toContain('post');
    expect(methods).toContain('delete');
  });

  it('should include error handling tests', () => {
    const suite = generateFromOpenAPI(sampleOpenAPI, 'pet-agent');
    const errorTests = suite.tests.filter(t => t.tags.includes('error-handling'));
    expect(errorTests.length).toBeGreaterThan(0);
    expect(errorTests[0].mocks).toBeDefined();
  });

  it('should use operationId as tool name when available', () => {
    const suite = generateFromOpenAPI(sampleOpenAPI, 'agent');
    const test = suite.tests.find(t => t.expect.tool_called === 'listPets');
    expect(test).toBeDefined();
  });

  it('should generate mock responses', () => {
    const suite = generateFromOpenAPI(sampleOpenAPI, 'agent');
    for (const test of suite.tests) {
      expect(test.mocks).toBeDefined();
      const mockKeys = Object.keys(test.mocks);
      expect(mockKeys.length).toBeGreaterThan(0);
    }
  });

  it('should handle required parameters', () => {
    const suite = generateFromOpenAPI(sampleOpenAPI, 'agent');
    const createTest = suite.tests.find(t =>
      t.expect.tool_called === 'createPet' && t.expect.tool_args_match
    );
    expect(createTest).toBeDefined();
    expect(createTest!.expect.tool_args_match).toHaveProperty('name');
  });

  it('should use example values from schema', () => {
    const suite = generateFromOpenAPI(sampleOpenAPI, 'agent');
    const getTest = suite.tests.find(t =>
      t.expect.tool_called === 'getPet' && t.expect.tool_args_match
    );
    expect(getTest).toBeDefined();
    expect(getTest!.expect.tool_args_match!.petId).toBe(42);
  });

  it('should format as YAML', () => {
    const suite = generateFromOpenAPI(sampleOpenAPI, 'agent');
    const yaml = formatOpenAPITests(suite);
    expect(yaml).toContain('name:');
    expect(yaml).toContain('tests:');
    expect(yaml).toContain('Pet Store');
  });

  it('should tag tests with openapi', () => {
    const suite = generateFromOpenAPI(sampleOpenAPI, 'agent');
    for (const test of suite.tests) {
      expect(test.tags).toContain('openapi');
    }
  });

  it('should generate missing-params tests for endpoints with required params', () => {
    const suite = generateFromOpenAPI(sampleOpenAPI, 'agent');
    const paramTests = suite.tests.filter(t => t.tags.includes('params'));
    expect(paramTests.length).toBeGreaterThan(0);
  });
});

// ===== Trace Visualization =====

describe('Trace Visualization', () => {
  const fullTrace = makeTrace([
    makeLLMStep('Find info about cats'),
    makeToolCallStep('search', { query: 'cats' }, 200),
    makeToolResultStep('search', { results: ['cat1', 'cat2'] }),
    makeThoughtStep('Found some results, let me summarize'),
    makeOutputStep('Here is what I found about cats...'),
  ]);

  it('should generate Mermaid sequence diagram', () => {
    const mermaid = traceToMermaid(fullTrace);
    expect(mermaid).toContain('sequenceDiagram');
    expect(mermaid).toContain('participant U as User');
    expect(mermaid).toContain('participant A as Agent');
    expect(mermaid).toContain('search');
  });

  it('should include tool participants', () => {
    const mermaid = traceToMermaid(fullTrace);
    expect(mermaid).toContain('participant T_search as search');
  });

  it('should show user messages', () => {
    const mermaid = traceToMermaid(fullTrace);
    expect(mermaid).toContain('Find info about cats');
  });

  it('should show tool calls and results', () => {
    const mermaid = traceToMermaid(fullTrace);
    expect(mermaid).toContain('A->>T_search');
    expect(mermaid).toContain('T_search-->>A');
  });

  it('should show agent output', () => {
    const mermaid = traceToMermaid(fullTrace);
    expect(mermaid).toContain('A->>U');
    expect(mermaid).toContain('found about cats');
  });

  it('should show thought notes', () => {
    const mermaid = traceToMermaid(fullTrace);
    expect(mermaid).toContain('💭');
    expect(mermaid).toContain('summarize');
  });

  it('should include timings by default', () => {
    const mermaid = traceToMermaid(fullTrace, { showTimings: true });
    expect(mermaid).toContain('200ms');
  });

  it('should hide timings when disabled', () => {
    const mermaid = traceToMermaid(fullTrace, { showTimings: false });
    expect(mermaid).not.toContain('200ms');
  });

  it('should show tokens when enabled', () => {
    const mermaid = traceToMermaid(fullTrace, { showTokens: true });
    expect(mermaid).toContain('50→100 tok');
  });

  it('should limit steps', () => {
    const mermaid = traceToMermaid(fullTrace, { maxSteps: 2 });
    // Should not contain output step (step 5)
    expect(mermaid).not.toContain('found about cats');
  });

  it('should add title when provided', () => {
    const mermaid = traceToMermaid(fullTrace, { title: 'My Test' });
    expect(mermaid).toContain('title My Test');
  });

  it('should generate plain text format', () => {
    const text = traceToText(fullTrace);
    expect(text).toContain('User → Agent');
    expect(text).toContain('Agent → search');
    expect(text).toContain('Agent → User');
  });

  it('should generate HTML with embedded Mermaid', () => {
    const html = traceToHtml(fullTrace);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('mermaid');
    expect(html).toContain('sequenceDiagram');
    expect(html).toContain(fullTrace.id);
  });

  it('should route via visualizeTrace helper', () => {
    expect(visualizeTrace(fullTrace, { format: 'mermaid' })).toContain('sequenceDiagram');
    expect(visualizeTrace(fullTrace, { format: 'text' })).toContain('→');
    expect(visualizeTrace(fullTrace, { format: 'html' })).toContain('<html>');
  });

  it('should handle empty trace', () => {
    const mermaid = traceToMermaid(makeTrace([]));
    expect(mermaid).toContain('sequenceDiagram');
    expect(mermaid).toContain('participant U as User');
  });

  it('should handle multiple tools', () => {
    const trace = makeTrace([
      makeToolCallStep('search', { q: 'a' }),
      makeToolResultStep('search', 'r1'),
      makeToolCallStep('fetch', { url: 'x' }),
      makeToolResultStep('fetch', 'r2'),
    ]);
    const mermaid = traceToMermaid(trace);
    expect(mermaid).toContain('T_search');
    expect(mermaid).toContain('T_fetch');
  });
});

// ===== VSCode Extension Scaffold =====

describe('VSCode Extension Scaffold', () => {
  const vscodeDir = path.join(__dirname, '..', 'src', 'vscode');

  it('should have package.json', () => {
    expect(fs.existsSync(path.join(vscodeDir, 'package.json'))).toBe(true);
  });

  it('should have correct extension metadata', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(vscodeDir, 'package.json'), 'utf-8'));
    expect(pkg.name).toBe('agentprobe-vscode');
    expect(pkg.engines.vscode).toBeDefined();
    expect(pkg.contributes.commands).toHaveLength(3);
  });

  it('should define Run Tests command', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(vscodeDir, 'package.json'), 'utf-8'));
    const cmd = pkg.contributes.commands.find((c: any) => c.command === 'agentprobe.runTests');
    expect(cmd).toBeDefined();
    expect(cmd.title).toContain('Run Tests');
  });

  it('should define View Trace command', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(vscodeDir, 'package.json'), 'utf-8'));
    const cmd = pkg.contributes.commands.find((c: any) => c.command === 'agentprobe.viewTrace');
    expect(cmd).toBeDefined();
  });

  it('should define Generate Test command', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(vscodeDir, 'package.json'), 'utf-8'));
    const cmd = pkg.contributes.commands.find((c: any) => c.command === 'agentprobe.generateTest');
    expect(cmd).toBeDefined();
  });

  it('should have tree view for results', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(vscodeDir, 'package.json'), 'utf-8'));
    expect(pkg.contributes.views.test).toBeDefined();
    expect(pkg.contributes.views.test[0].id).toBe('agentprobeResults');
  });

  it('should have YAML syntax highlighting', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(vscodeDir, 'package.json'), 'utf-8'));
    expect(pkg.contributes.grammars).toBeDefined();
    expect(pkg.contributes.grammars[0].scopeName).toBe('source.agentprobe');
  });

  it('should have extension.ts source', () => {
    expect(fs.existsSync(path.join(vscodeDir, 'src', 'extension.ts'))).toBe(true);
  });

  it('should have tree provider source', () => {
    expect(fs.existsSync(path.join(vscodeDir, 'src', 'treeProvider.ts'))).toBe(true);
  });

  it('should have status bar source', () => {
    expect(fs.existsSync(path.join(vscodeDir, 'src', 'statusBar.ts'))).toBe(true);
  });

  it('should have tmLanguage grammar', () => {
    const grammarPath = path.join(vscodeDir, 'syntaxes', 'agentprobe.tmLanguage.json');
    expect(fs.existsSync(grammarPath)).toBe(true);
    const grammar = JSON.parse(fs.readFileSync(grammarPath, 'utf-8'));
    expect(grammar.scopeName).toBe('source.agentprobe');
  });
});

// ===== GitHub Action =====

describe('GitHub Action', () => {
  const actionDir = path.join(__dirname, '..', 'src', 'github-action');

  it('should have action.yml', () => {
    expect(fs.existsSync(path.join(actionDir, 'action.yml'))).toBe(true);
  });

  it('should have correct action metadata', () => {
    const raw = fs.readFileSync(path.join(actionDir, 'action.yml'), 'utf-8');
    expect(raw).toContain("name: 'AgentProbe");
    expect(raw).toContain('inputs:');
    expect(raw).toContain('outputs:');
  });

  it('should define suite input', () => {
    const raw = fs.readFileSync(path.join(actionDir, 'action.yml'), 'utf-8');
    expect(raw).toContain('suite:');
  });

  it('should define budget input', () => {
    const raw = fs.readFileSync(path.join(actionDir, 'action.yml'), 'utf-8');
    expect(raw).toContain('budget:');
    expect(raw).toContain('5.00');
  });

  it('should define fail_on_regression input', () => {
    const raw = fs.readFileSync(path.join(actionDir, 'action.yml'), 'utf-8');
    expect(raw).toContain('fail_on_regression:');
  });

  it('should use composite run steps', () => {
    const raw = fs.readFileSync(path.join(actionDir, 'action.yml'), 'utf-8');
    expect(raw).toContain("using: 'composite'");
  });

  it('should have README', () => {
    expect(fs.existsSync(path.join(actionDir, 'README.md'))).toBe(true);
  });
});

// ===== Integration: Replay + Viz =====

describe('Integration', () => {
  it('should replay then visualize', () => {
    const trace = makeTrace([
      makeLLMStep('test'),
      makeToolCallStep('search', { q: 'x' }),
      makeToolResultStep('search', 'result'),
      makeOutputStep('done'),
    ]);
    const replayed = replayTrace({ trace, overrides: {} });
    const mermaid = traceToMermaid(replayed.trace);
    expect(mermaid).toContain('sequenceDiagram');
    expect(mermaid).toContain('search');
  });

  it('should replay with overrides then visualize modified trace', () => {
    const trace = makeTrace([
      makeToolCallStep('api', { url: '/data' }),
      makeToolResultStep('api', { data: 'original' }),
    ]);
    const replayed = replayTrace({
      trace,
      overrides: { api: { return: { data: 'modified' } } },
    });
    const text = traceToText(replayed.trace);
    expect(text).toContain('api');
  });
});
