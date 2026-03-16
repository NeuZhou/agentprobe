import { describe, it, expect } from 'vitest';
import { generateSecurityTests, securityTestsToYaml, INJECTION_PATTERNS, EXFIL_PATTERNS, PRIVILEGE_PATTERNS } from '../src/security';
import YAML from 'yaml';

describe('security', () => {
  it('generates injection patterns', () => {
    const tests = generateSecurityTests({ categories: ['injection'] });
    expect(tests.length).toBe(INJECTION_PATTERNS.length);
    expect(tests.every(t => t.tags.includes('injection'))).toBe(true);
  });

  it('generates exfil patterns', () => {
    const tests = generateSecurityTests({ categories: ['exfiltration'] });
    expect(tests.length).toBe(EXFIL_PATTERNS.length);
    expect(tests.every(t => t.tags.includes('exfiltration'))).toBe(true);
  });

  it('generates escalation patterns', () => {
    const tests = generateSecurityTests({ categories: ['privilege'] });
    expect(tests.length).toBe(PRIVILEGE_PATTERNS.length);
    expect(tests.every(t => t.tags.includes('privilege'))).toBe(true);
  });

  it('output is valid YAML', () => {
    const tests = generateSecurityTests();
    const yamlObj = securityTestsToYaml(tests);
    const yamlStr = YAML.stringify(yamlObj);
    const parsed = YAML.parse(yamlStr);
    expect(parsed.name).toContain('Security');
    expect(parsed.tests.length).toBeGreaterThan(0);
  });

  it('generates all categories by default', () => {
    const tests = generateSecurityTests();
    const tags = new Set(tests.flatMap(t => t.tags));
    expect(tags).toContain('injection');
    expect(tags).toContain('exfiltration');
    expect(tags).toContain('privilege');
    expect(tags).toContain('harmful');
  });
});
