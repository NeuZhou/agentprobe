import { describe, it, expect } from 'vitest';
import { buildExecutionPlan, shouldSkip } from '../src/deps';

describe('deps', () => {
  it('groups independent tests together', () => {
    const plan = buildExecutionPlan([
      { name: 'a', id: 'a', input: '', expect: {} as any },
      { name: 'b', id: 'b', input: '', expect: {} as any },
    ]);
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0]).toHaveLength(2);
  });

  it('orders dependent tests after dependencies', () => {
    const plan = buildExecutionPlan([
      { name: 'create', id: 'create', input: '', expect: {} as any },
      { name: 'read', id: 'read', input: '', depends_on: 'create', expect: {} as any },
    ]);
    expect(plan.groups).toHaveLength(2);
    expect(plan.groups[0][0].name).toBe('create');
    expect(plan.groups[1][0].name).toBe('read');
  });

  it('handles multi-level dependencies', () => {
    const plan = buildExecutionPlan([
      { name: 'a', id: 'a', input: '', expect: {} as any },
      { name: 'b', id: 'b', input: '', depends_on: 'a', expect: {} as any },
      { name: 'c', id: 'c', input: '', depends_on: 'b', expect: {} as any },
    ]);
    expect(plan.groups).toHaveLength(3);
  });
});

describe('shouldSkip', () => {
  it('does not skip test without deps', () => {
    const result = shouldSkip({ name: 'a', input: '', expect: {} as any }, new Map());
    expect(result.skip).toBe(false);
  });

  it('skips when dependency failed', () => {
    const result = shouldSkip(
      { name: 'b', input: '', depends_on: 'a', expect: {} as any },
      new Map([['a', false]]),
    );
    expect(result.skip).toBe(true);
    expect(result.reason).toContain('failed');
  });

  it('does not skip when dependency passed', () => {
    const result = shouldSkip(
      { name: 'b', input: '', depends_on: 'a', expect: {} as any },
      new Map([['a', true]]),
    );
    expect(result.skip).toBe(false);
  });
});
