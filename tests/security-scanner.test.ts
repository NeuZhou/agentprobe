import { describe, it, expect } from 'vitest';
import { A2ASecurityScanner, formatSecurityReport } from '../src/security/a2a-scanner';
import type { SecurityFinding, SecurityReport } from '../src/security/a2a-scanner';

describe('A2ASecurityScanner', () => {
  describe('constructor', () => {
    it('creates scanner with default config', () => {
      const scanner = new A2ASecurityScanner();
      expect(scanner).toBeDefined();
    });

    it('accepts custom config', () => {
      const scanner = new A2ASecurityScanner({
        timeout_ms: 5000,
        strictHttps: false,
        minAuthSchemes: 2,
      });
      expect(scanner).toBeDefined();
    });
  });

  describe('buildReport (via scanAgentCard with unreachable host)', () => {
    it('produces a report with findings when agent card fetch fails', async () => {
      const scanner = new A2ASecurityScanner({ timeout_ms: 500 });
      // Use an unreachable URL to trigger connectivity error
      const report = await scanner.scanAgentCard('https://nonexistent-agent-12345.example.invalid');
      expect(report).toBeDefined();
      expect(report.target).toBe('https://nonexistent-agent-12345.example.invalid');
      expect(report.timestamp).toBeDefined();
      expect(report.findings.length).toBeGreaterThan(0);
      expect(typeof report.score).toBe('number');
      expect(report.score).toBeLessThanOrEqual(100);
      expect(report.score).toBeGreaterThanOrEqual(0);
      expect(typeof report.passed).toBe('boolean');
      expect(typeof report.summary).toBe('string');
    });

    it('flags HTTP URLs when strictHttps is true', async () => {
      const scanner = new A2ASecurityScanner({ timeout_ms: 500, strictHttps: true });
      const report = await scanner.scanAgentCard('http://nonexistent-agent-12345.example.invalid');
      const httpFinding = report.findings.find(f => f.category === 'transport');
      expect(httpFinding).toBeDefined();
      expect(httpFinding!.severity).toBe('critical');
    });

    it('does not flag HTTP when strictHttps is false', async () => {
      const scanner = new A2ASecurityScanner({ timeout_ms: 500, strictHttps: false });
      const report = await scanner.scanAgentCard('http://nonexistent-agent-12345.example.invalid');
      const httpFinding = report.findings.find(f => f.category === 'transport');
      expect(httpFinding).toBeUndefined();
    });
  });

  describe('score calculation', () => {
    // We can test the scoring logic indirectly
    it('produces lower score for more severe findings', async () => {
      const scanner = new A2ASecurityScanner({ timeout_ms: 500 });
      // HTTP + fetch failure = critical + high findings = lower score
      const httpReport = await scanner.scanAgentCard('http://nonexistent.example.invalid');
      const httpsReport = await scanner.scanAgentCard('https://nonexistent.example.invalid');
      // HTTP version has additional critical finding
      expect(httpReport.score).toBeLessThanOrEqual(httpsReport.score);
    });
  });
});

describe('formatSecurityReport', () => {
  it('formats a report with findings', () => {
    const report: SecurityReport = {
      target: 'https://example.com',
      timestamp: '2026-01-01T00:00:00Z',
      findings: [
        {
          severity: 'critical',
          category: 'transport',
          title: 'No HTTPS',
          description: 'Agent uses HTTP',
          recommendation: 'Use HTTPS',
        },
        {
          severity: 'medium',
          category: 'cors',
          title: 'Wildcard CORS',
          description: 'CORS is *',
        },
        {
          severity: 'info',
          category: 'metadata',
          title: 'Version missing',
          description: 'No version',
        },
      ],
      score: 60,
      passed: true,
      summary: '3 findings (1 critical, 0 high) — Score: 60/100',
    };

    const formatted = formatSecurityReport(report);
    expect(formatted).toContain('Security Report');
    expect(formatted).toContain('60/100');
    expect(formatted).toContain('CRITICAL');
    expect(formatted).toContain('MEDIUM');
    expect(formatted).toContain('No HTTPS');
    expect(formatted).toContain('Use HTTPS');
    expect(formatted).toContain('🔴');
    expect(formatted).toContain('🟡');
    expect(formatted).toContain('ℹ️');
  });

  it('formats empty findings report', () => {
    const report: SecurityReport = {
      target: 'https://secure.example.com',
      timestamp: '2026-01-01T00:00:00Z',
      findings: [],
      score: 100,
      passed: true,
      summary: '0 findings — Score: 100/100',
    };

    const formatted = formatSecurityReport(report);
    expect(formatted).toContain('100/100');
    expect(formatted).toContain('✅');
  });

  it('shows fail icon for non-passing report', () => {
    const report: SecurityReport = {
      target: 'http://insecure.example.com',
      timestamp: '2026-01-01T00:00:00Z',
      findings: [
        { severity: 'critical', category: 'transport', title: 'No HTTPS', description: 'HTTP' },
        { severity: 'critical', category: 'auth', title: 'No auth', description: 'none' },
      ],
      score: 40,
      passed: false,
      summary: '2 findings (2 critical) — Score: 40/100',
    };

    const formatted = formatSecurityReport(report);
    expect(formatted).toContain('❌');
  });
});

describe('SecurityFinding types', () => {
  it('supports all severity levels', () => {
    const severities: SecurityFinding['severity'][] = ['critical', 'high', 'medium', 'low', 'info'];
    for (const severity of severities) {
      const finding: SecurityFinding = {
        severity,
        category: 'test',
        title: 'Test',
        description: 'test',
      };
      expect(finding.severity).toBe(severity);
    }
  });
});
