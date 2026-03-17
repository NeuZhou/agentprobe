/**
 * Issue #4: API reference documentation
 * Tests that comprehensive API docs exist and are accurate.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const DOCS_DIR = path.resolve(__dirname, '..', 'docs');

describe('API Reference Documentation (Issue #4)', () => {
  describe('docs/API.md comprehensive reference', () => {
    const apiDocPath = path.join(DOCS_DIR, 'API.md');

    it('should exist', () => {
      expect(fs.existsSync(apiDocPath)).toBe(true);
    });

    it('should document core API functions', () => {
      const content = fs.readFileSync(apiDocPath, 'utf-8');
      expect(content).toContain('runSuite');
      expect(content).toContain('evaluate');
      expect(content).toContain('Recorder');
    });

    it('should document all assertion types', () => {
      const content = fs.readFileSync(apiDocPath, 'utf-8');
      const assertions = [
        'tool_called',
        'tool_not_called',
        'tool_sequence',
        'tool_args_match',
        'output_contains',
        'output_not_contains',
        'output_matches',
        'max_steps',
        'max_tokens',
        'max_cost_usd',
        'max_duration_ms',
      ];
      for (const assertion of assertions) {
        expect(content).toContain(assertion);
      }
    });

    it('should document adapter types', () => {
      const content = fs.readFileSync(apiDocPath, 'utf-8');
      expect(content).toContain('openai');
      expect(content).toContain('anthropic');
      expect(content).toContain('crewai');
      expect(content).toContain('autogen');
    });

    it('should include TypeScript code examples', () => {
      const content = fs.readFileSync(apiDocPath, 'utf-8');
      expect(content).toContain('```typescript');
    });

    it('should include type definitions', () => {
      const content = fs.readFileSync(apiDocPath, 'utf-8');
      expect(content).toContain('AgentTrace');
      expect(content).toContain('TraceStep');
      expect(content).toContain('TestCase');
      expect(content).toContain('SuiteResult');
    });
  });

  describe('docs/adapters.md', () => {
    const adaptersDocPath = path.join(DOCS_DIR, 'adapters.md');

    it('should exist', () => {
      expect(fs.existsSync(adaptersDocPath)).toBe(true);
    });

    it('should document CrewAI adapter', () => {
      const content = fs.readFileSync(adaptersDocPath, 'utf-8');
      expect(content.toLowerCase()).toContain('crewai');
    });

    it('should document AutoGen adapter', () => {
      const content = fs.readFileSync(adaptersDocPath, 'utf-8');
      expect(content.toLowerCase()).toContain('autogen');
    });
  });

  describe('docs/cli-reference.md', () => {
    const cliDocPath = path.join(DOCS_DIR, 'cli-reference.md');

    it('should exist', () => {
      expect(fs.existsSync(cliDocPath)).toBe(true);
    });

    it('should document main CLI commands', () => {
      const content = fs.readFileSync(cliDocPath, 'utf-8');
      expect(content).toContain('run');
      expect(content).toContain('record');
      expect(content).toContain('convert');
    });
  });

  describe('docs/getting-started.md', () => {
    const gsDocPath = path.join(DOCS_DIR, 'getting-started.md');

    it('should exist', () => {
      expect(fs.existsSync(gsDocPath)).toBe(true);
    });

    it('should have installation instructions', () => {
      const content = fs.readFileSync(gsDocPath, 'utf-8');
      expect(content).toContain('npm');
      expect(content).toContain('install');
    });
  });
});
