import { describe, it, expect } from 'vitest';
import { expandTemplate, listTemplates, registerTemplate, isTemplate } from '../src/templates';

describe('templates', () => {
  it('rag_pipeline template expands correctly', () => {
    const result = expandTemplate('rag_pipeline');
    expect(result.tool_sequence).toEqual(['embed', 'search', 'generate']);
    expect(result.max_steps).toBeDefined();
    expect(result.max_cost_usd).toBeDefined();
  });

  it('safety_basic template assertions', () => {
    const result = expandTemplate('safety_basic');
    expect(result.tool_not_called).toContain('exec');
    expect(result.output_not_contains).toBeDefined();
  });

  it('safety_strict includes all safety_basic + more', () => {
    const basic = expandTemplate('safety_basic');
    const strict = expandTemplate('safety_strict');
    const basicBlocked = basic.tool_not_called as string[];
    const strictBlocked = strict.tool_not_called as string[];
    for (const tool of basicBlocked) {
      expect(strictBlocked).toContain(tool);
    }
    const strictOutput = strict.output_not_contains as string[];
    expect(strictOutput.length).toBeGreaterThan((basic.output_not_contains as string[]).length);
  });

  it('chatbot_quality template', () => {
    const result = expandTemplate('chatbot_quality');
    expect(result.max_duration_ms).toBeDefined();
    expect(result.max_steps).toBeDefined();
  });

  it('tool_hygiene template', () => {
    const result = expandTemplate('tool_hygiene');
    expect(result.max_steps).toBeDefined();
    expect(result.max_tokens).toBeDefined();
  });

  it('custom template registration', () => {
    registerTemplate('my_custom', {
      name: 'my_custom',
      description: 'test',
      expand: () => ({ max_steps: 3 }),
    });
    const result = expandTemplate('my_custom');
    expect(result.max_steps).toBe(3);
  });

  it('unknown template name → error', () => {
    expect(() => expandTemplate('nonexistent_template_xyz')).toThrow('Unknown template');
  });

  it('template with params', () => {
    const result = expandTemplate('rag_pipeline', {
      params: { max_steps: 50 },
    });
    expect(result.max_steps).toBe(50);
  });

  it('template with overrides', () => {
    const result = expandTemplate('safety_basic', {
      overrides: { max_steps: 10 },
    });
    expect(result.max_steps).toBe(10);
  });

  it('list built-in templates', () => {
    const templates = listTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(8);
    const names = templates.map(t => t.name);
    expect(names).toContain('rag_pipeline');
    expect(names).toContain('safety_basic');
  });

  it('isTemplate returns true for known templates', () => {
    expect(isTemplate('rag_pipeline')).toBe(true);
    expect(isTemplate('nonexistent')).toBe(false);
  });

  it('security_scan template blocks sensitive patterns', () => {
    const result = expandTemplate('security_scan');
    const blocked = result.output_not_contains as string[];
    expect(blocked).toContain('sk-');
    expect(blocked).toContain('password');
    expect(blocked).toContain('Bearer ');
    expect(result.tool_not_called).toContain('exec');
    expect(result.max_steps).toBeDefined();
  });

  it('security_scan template accepts custom sensitive patterns', () => {
    const result = expandTemplate('security_scan', {
      params: { sensitive_patterns: ['MY_SECRET', 'CUSTOM_TOKEN'] },
    });
    const blocked = result.output_not_contains as string[];
    expect(blocked).toContain('MY_SECRET');
    expect(blocked).toContain('CUSTOM_TOKEN');
    expect(blocked).not.toContain('sk-');
  });

  it('hallucination_check template has judge criteria', () => {
    const result = expandTemplate('hallucination_check');
    const blocked = result.output_not_contains as string[];
    expect(blocked).toContain('I made that up');
    expect(blocked).toContain('I hallucinated');
    expect(result.judge).toBeDefined();
    expect(result.judge!.criteria).toContain('verifiable');
    expect(result.judge!.threshold).toBe(0.8);
    expect(result.max_tokens).toBeDefined();
  });

  it('hallucination_check template accepts custom judge', () => {
    const customJudge = { criteria: 'Custom check', threshold: 0.9 };
    const result = expandTemplate('hallucination_check', {
      params: { judge: customJudge },
    });
    expect(result.judge).toEqual(customJudge);
  });

  it('tool_misuse template blocks dangerous tools', () => {
    const result = expandTemplate('tool_misuse');
    const blocked = result.tool_not_called as string[];
    expect(blocked).toContain('exec');
    expect(blocked).toContain('sudo');
    expect(blocked).toContain('chmod');
    expect(result.max_cost_usd).toBeDefined();
    expect(result.custom).toContain('toolCalls.length');
  });

  it('tool_misuse template accepts custom dangerous tools list', () => {
    const result = expandTemplate('tool_misuse', {
      params: { dangerous_tools: ['my_dangerous_tool'] },
    });
    const blocked = result.tool_not_called as string[];
    expect(blocked).toContain('my_dangerous_tool');
    expect(blocked).not.toContain('exec');
  });

  it('list includes new templates', () => {
    const templates = listTemplates();
    const names = templates.map(t => t.name);
    expect(names).toContain('security_scan');
    expect(names).toContain('hallucination_check');
    expect(names).toContain('tool_misuse');
  });

  it('isTemplate returns true for new templates', () => {
    expect(isTemplate('security_scan')).toBe(true);
    expect(isTemplate('hallucination_check')).toBe(true);
    expect(isTemplate('tool_misuse')).toBe(true);
  });
});
