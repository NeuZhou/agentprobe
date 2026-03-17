import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentTrace } from '../../src/types';

// We need to mock the dynamic require inside clawguard.ts
// Override require resolution for @neuzhou/clawguard
const mockScan = vi.fn();

vi.mock('@neuzhou/clawguard', () => ({
  default: { scan: mockScan },
  scan: mockScan,
}));

// Must import AFTER vi.mock
import {
  ClawGuardIntegration,
  isClawGuardAvailable,
  createSecurityScanAssertion,
  _resetClawGuardCache,
} from '../../src/integrations/clawguard';

const dummyTrace: AgentTrace = {
  id: 'test-1',
  timestamp: new Date().toISOString(),
  steps: [],
  metadata: {},
};

describe('ClawGuard Integration', () => {
  beforeEach(() => {
    _resetClawGuardCache();
    ClawGuardIntegration._lastScanResult = null;
    mockScan.mockReset();
  });

  describe('ClawGuardIntegration', () => {
    it('creates a valid plugin', () => {
      const integration = new ClawGuardIntegration({ scanPath: './src' });
      const plugin = integration.toPlugin();

      expect(plugin.name).toBe('clawguard');
      expect(plugin.type).toBe('assertion');
      expect(plugin.assertions).toHaveProperty('toPassSecurityScan');
      expect(plugin.hooks).toBeDefined();
    });

    it('clears result on suite complete', async () => {
      ClawGuardIntegration._lastScanResult = {
        findings: [],
        scannedFiles: 1,
        duration_ms: 10,
      };

      const integration = new ClawGuardIntegration();
      const plugin = integration.toPlugin();
      await plugin.hooks!.onSuiteComplete!({
        name: 'test',
        passed: 1,
        failed: 0,
        total: 1,
        duration_ms: 100,
        results: [],
      });

      expect(ClawGuardIntegration._lastScanResult).toBeNull();
    });
  });

  describe('toPassSecurityScan assertion', () => {
    it('passes when no findings exceed threshold', () => {
      ClawGuardIntegration._lastScanResult = {
        findings: [
          { id: '1', severity: 'low', message: 'Minor issue', rule: 'rule-1' },
          { id: '2', severity: 'info', message: 'Info', rule: 'rule-2' },
        ],
        scannedFiles: 5,
        duration_ms: 20,
      };

      const handler = createSecurityScanAssertion({ failOn: ['critical', 'high'] });
      const result = handler(dummyTrace, undefined);

      expect(result.passed).toBe(true);
      expect(result.name).toBe('toPassSecurityScan');
    });

    it('fails when findings exceed threshold', () => {
      ClawGuardIntegration._lastScanResult = {
        findings: [
          { id: '1', severity: 'critical', message: 'SQL injection', rule: 'sqli' },
          { id: '2', severity: 'low', message: 'Minor', rule: 'minor' },
        ],
        scannedFiles: 5,
        duration_ms: 20,
      };

      const handler = createSecurityScanAssertion({ failOn: ['critical', 'high'] });
      const result = handler(dummyTrace, undefined);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('1 security finding(s)');
    });

    it('passes when no scan was run (skipped)', () => {
      ClawGuardIntegration._lastScanResult = null;
      const handler = createSecurityScanAssertion();
      const result = handler(dummyTrace, undefined);

      expect(result.passed).toBe(true);
      expect(result.message).toContain('skipped');
    });

    it('respects custom failOn levels', () => {
      ClawGuardIntegration._lastScanResult = {
        findings: [
          { id: '1', severity: 'medium', message: 'XSS', rule: 'xss' },
        ],
        scannedFiles: 3,
        duration_ms: 15,
      };

      const handler = createSecurityScanAssertion({ failOn: ['critical', 'high', 'medium'] });
      const result = handler(dummyTrace, undefined);

      expect(result.passed).toBe(false);
    });

    it('includes violation details in actual field', () => {
      ClawGuardIntegration._lastScanResult = {
        findings: [
          { id: '1', severity: 'high', message: 'Unsafe eval', rule: 'no-eval' },
          { id: '2', severity: 'critical', message: 'Hardcoded secret', rule: 'no-secrets' },
        ],
        scannedFiles: 10,
        duration_ms: 50,
      };

      const handler = createSecurityScanAssertion({ failOn: ['critical', 'high'] });
      const result = handler(dummyTrace, undefined);

      expect(result.passed).toBe(false);
      expect(result.actual).toHaveLength(2);
      expect(result.actual[0]).toContain('no-eval');
      expect(result.actual[1]).toContain('no-secrets');
    });
  });
});
