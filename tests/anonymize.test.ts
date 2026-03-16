import { describe, it, expect } from 'vitest';
import { anonymize, anonymizeString, anonymizeTrace } from '../src/anonymize';

describe('anonymize', () => {
  it('redacts OpenAI API keys (sk-)', () => {
    const result = anonymizeString('key is sk-abc123def456ghi789jkl012mno345');
    expect(result).not.toContain('sk-abc123');
    expect(result).toContain('[REDACTED]');
  });

  it('redacts AWS keys (AKIA)', () => {
    const result = anonymizeString('AWS key AKIAIOSFODNN7EXAMPLE');
    expect(result).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(result).toContain('[REDACTED]');
  });

  it('redacts emails', () => {
    const result = anonymizeString('contact me at john@example.com');
    expect(result).not.toContain('john@example.com');
    expect(result).toContain('user@example.com');
  });

  it('redacts IP addresses', () => {
    const result = anonymizeString('server at 10.0.0.1');
    expect(result).not.toContain('10.0.0.1');
  });

  it('redacts phone numbers', () => {
    const result = anonymizeString('call me at 555-123-4567');
    expect(result).toContain('[PHONE]');
  });

  it('preserves non-sensitive data', () => {
    const result = anonymizeString('hello world 42');
    expect(result).toBe('hello world 42');
  });

  it('handles nested objects', () => {
    const result = anonymize({ a: { b: { email: 'test@test.com' } } });
    expect(result.a.b.email).toBe('user@example.com');
  });

  it('handles arrays', () => {
    const result = anonymize(['test@test.com', 'hello']);
    expect(result[0]).toBe('user@example.com');
    expect(result[1]).toBe('hello');
  });

  it('empty trace', () => {
    const result = anonymizeTrace({});
    expect(result).toEqual({});
  });

  it('multiple sensitive values in same string', () => {
    const result = anonymizeString('email: a@b.com ip: 10.0.0.1');
    expect(result).not.toContain('a@b.com');
    expect(result).not.toContain('10.0.0.1');
  });

  it('custom redaction patterns', () => {
    const result = anonymizeString('code: ABC-123', { custom: [{ pattern: 'ABC-\\d+', replacement: '[CODE]' }] });
    expect(result).toContain('[CODE]');
  });

  it('redacts Anthropic keys (sk-ant-)', () => {
    const result = anonymizeString('key is sk-ant-abc123def456ghi789jkl012');
    expect(result).toContain('[REDACTED]');
  });

  it('redacts GitHub tokens (ghp_)', () => {
    const result = anonymizeString('token ghp_ABCDEFghijklmnopqrstuvwxyz1234567890');
    expect(result).toContain('[REDACTED]');
  });

  it('redacts Bearer tokens', () => {
    const result = anonymizeString('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6');
    expect(result).toContain('[REDACTED]');
  });

  it('redacts sensitive object keys entirely', () => {
    const result = anonymize({ password: 'mysecret', name: 'public' });
    expect(result.password).toBe('[REDACTED]');
    expect(result.name).toBe('public');
  });

  it('handles null and undefined values', () => {
    expect(anonymize(null)).toBeNull();
    expect(anonymize(undefined)).toBeUndefined();
  });

  it('preserves numbers and booleans', () => {
    expect(anonymize(42)).toBe(42);
    expect(anonymize(true)).toBe(true);
  });
});
