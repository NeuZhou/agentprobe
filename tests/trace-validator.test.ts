import { describe, it, expect } from 'vitest';
import { validateTraceFormat } from '../src/trace-validator';

describe('Trace Validator', () => {
  function validTrace() {
    return {
      id: 'test-1',
      timestamp: '2025-01-01T00:00:00Z',
      steps: [
        { type: 'llm_call', data: { model: 'gpt-4' }, timestamp: '2025-01-01T00:00:01Z' },
        { type: 'output', data: { content: 'hello' }, timestamp: '2025-01-01T00:00:02Z' },
      ],
      metadata: {},
    };
  }

  it('validates a correct trace', () => {
    const result = validateTraceFormat(validTrace());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects null input', () => {
    const result = validateTraceFormat(null);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain('JSON object');
  });

  it('rejects non-object input', () => {
    const result = validateTraceFormat('not an object');
    expect(result.valid).toBe(false);
  });

  it('warns on missing id field', () => {
    const trace = validTrace();
    delete (trace as any).id;
    const result = validateTraceFormat(trace);
    expect(result.warnings.some(w => w.message.includes('id'))).toBe(true);
  });

  it('warns on missing timestamp field', () => {
    const trace = validTrace();
    delete (trace as any).timestamp;
    const result = validateTraceFormat(trace);
    expect(result.warnings.some(w => w.message.includes('timestamp'))).toBe(true);
  });

  it('errors on missing steps array', () => {
    const result = validateTraceFormat({ id: 'x', timestamp: 'y' });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('steps'))).toBe(true);
  });

  it('errors on non-array steps', () => {
    const result = validateTraceFormat({ id: 'x', timestamp: 'y', steps: 'not-array' });
    expect(result.valid).toBe(false);
  });

  it('errors on step missing type field', () => {
    const trace = {
      id: 'x',
      timestamp: 'y',
      steps: [{ data: {} }],
      metadata: {},
    };
    const result = validateTraceFormat(trace);
    expect(result.errors.some(e => e.message.includes('type'))).toBe(true);
  });

  it('errors on invalid step type', () => {
    const trace = {
      id: 'x',
      timestamp: 'y',
      steps: [{ type: 'invalid_type', data: {}, timestamp: 't' }],
      metadata: {},
    };
    const result = validateTraceFormat(trace);
    const hasTypeError = result.errors.some(e => e.message.includes('type')) ||
                        result.warnings.some(w => w.message.includes('type'));
    expect(hasTypeError).toBe(true);
  });

  it('handles empty steps array as valid', () => {
    const trace = { id: 'x', timestamp: 'y', steps: [], metadata: {} };
    const result = validateTraceFormat(trace);
    expect(result.valid).toBe(true);
  });

  it('errors on step that is not an object', () => {
    const trace = {
      id: 'x',
      timestamp: 'y',
      steps: ['not-an-object'],
      metadata: {},
    };
    const result = validateTraceFormat(trace);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('validates all valid step types', () => {
    const validTypes = ['llm_call', 'tool_call', 'tool_result', 'thought', 'output'];
    for (const type of validTypes) {
      const trace = {
        id: 'x',
        timestamp: 'y',
        steps: [{ type, data: {}, timestamp: 't' }],
        metadata: {},
      };
      const result = validateTraceFormat(trace);
      const hasTypeError = result.errors.some(e =>
        e.path?.includes('type') && e.message.includes('Invalid')
      );
      expect(hasTypeError).toBe(false);
    }
  });

  it('reports path information in validation messages', () => {
    const trace = {
      id: 'x',
      timestamp: 'y',
      steps: [{ data: {} }],
      metadata: {},
    };
    const result = validateTraceFormat(trace);
    const errorWithPath = result.errors.find(e => e.path);
    expect(errorWithPath).toBeDefined();
    expect(errorWithPath!.path).toContain('steps[0]');
  });
});
