/**
 * Issue #2: Add more built-in test templates
 * Tests for new templates: multi-agent, data-pipeline, customer-support, code-review
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  expandTemplate,
  listTemplates,
  isTemplate,
  registerTemplate,
} from '../src/templates';
import {
  listTestTemplates,
  getTestTemplate,
  getTemplateContent,
  hasTemplate as hasTestTemplate,
} from '../src/templates-lib';

describe('Built-in Test Templates (Issue #2)', () => {
  describe('assertion templates', () => {
    it('should have at least 10 built-in assertion templates', () => {
      const templates = listTemplates();
      expect(templates.length).toBeGreaterThanOrEqual(10);
    });

    // New templates to add
    describe('multi_agent_orchestration template', () => {
      it('should exist', () => {
        expect(isTemplate('multi_agent_orchestration')).toBe(true);
      });

      it('should enforce max steps and cost', () => {
        const expanded = expandTemplate('multi_agent_orchestration');
        expect(expanded.max_steps).toBeDefined();
        expect(expanded.max_cost_usd).toBeDefined();
      });

      it('should block dangerous tools', () => {
        const expanded = expandTemplate('multi_agent_orchestration');
        expect(expanded.tool_not_called).toBeDefined();
        const blocked = Array.isArray(expanded.tool_not_called)
          ? expanded.tool_not_called
          : [expanded.tool_not_called];
        expect(blocked).toContain('exec');
      });
    });

    describe('data_pipeline template', () => {
      it('should exist', () => {
        expect(isTemplate('data_pipeline')).toBe(true);
      });

      it('should enforce a typical ETL sequence', () => {
        const expanded = expandTemplate('data_pipeline');
        expect(expanded.tool_sequence).toBeDefined();
        expect(expanded.tool_sequence!.length).toBeGreaterThanOrEqual(2);
      });

      it('should accept custom sequence params', () => {
        const expanded = expandTemplate('data_pipeline', {
          params: { sequence: ['extract', 'transform', 'load'] },
        });
        expect(expanded.tool_sequence).toEqual(['extract', 'transform', 'load']);
      });
    });

    describe('customer_support template', () => {
      it('should exist', () => {
        expect(isTemplate('customer_support')).toBe(true);
      });

      it('should check for polite output', () => {
        const expanded = expandTemplate('customer_support');
        expect(expanded.output_not_contains).toBeDefined();
        const forbidden = Array.isArray(expanded.output_not_contains)
          ? expanded.output_not_contains
          : [expanded.output_not_contains!];
        // Should forbid rude/unprofessional phrases
        expect(forbidden.length).toBeGreaterThan(0);
      });

      it('should have duration and step budgets', () => {
        const expanded = expandTemplate('customer_support');
        expect(expanded.max_duration_ms).toBeDefined();
        expect(expanded.max_steps).toBeDefined();
      });
    });

    describe('code_review template', () => {
      it('should exist', () => {
        expect(isTemplate('code_review')).toBe(true);
      });

      it('should require read_file before any write', () => {
        const expanded = expandTemplate('code_review');
        expect(expanded.tool_sequence).toBeDefined();
        expect(expanded.tool_sequence![0]).toBe('read_file');
      });

      it('should block dangerous tools', () => {
        const expanded = expandTemplate('code_review');
        expect(expanded.tool_not_called).toBeDefined();
      });
    });

    describe('api_integration template', () => {
      it('should exist', () => {
        expect(isTemplate('api_integration')).toBe(true);
      });

      it('should have cost and step limits', () => {
        const expanded = expandTemplate('api_integration');
        expect(expanded.max_cost_usd).toBeDefined();
        expect(expanded.max_steps).toBeDefined();
      });
    });
  });

  describe('test template library', () => {
    it('should have at least 8 test templates', () => {
      const templates = listTestTemplates();
      expect(templates.length).toBeGreaterThanOrEqual(8);
    });

    it('should have multi-agent template', () => {
      expect(hasTestTemplate('multi-agent')).toBe(true);
      const tmpl = getTestTemplate('multi-agent');
      expect(tmpl).toBeDefined();
      expect(tmpl!.category).toBe('multi-agent');
    });

    it('should have data-pipeline template', () => {
      expect(hasTestTemplate('data-pipeline')).toBe(true);
      const tmpl = getTestTemplate('data-pipeline');
      expect(tmpl).toBeDefined();
    });

    it('template content should be valid YAML', () => {
      const templates = listTestTemplates();
      for (const tmpl of templates) {
        expect(() => {
          const content = getTemplateContent(tmpl.name);
          const parsed = require('yaml').parse(content);
          expect(parsed).toBeDefined();
        }).not.toThrow();
      }
    });

    it('template content should have name and tests fields', () => {
      const templates = listTestTemplates();
      for (const tmpl of templates) {
        // MCP server template has a different format
        if (tmpl.category === 'mcp-server') continue;
        const content = getTemplateContent(tmpl.name);
        const parsed = require('yaml').parse(content);
        expect(parsed.name).toBeDefined();
        expect(parsed.tests).toBeDefined();
      }
    });
  });
});
