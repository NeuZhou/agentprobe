/**
 * Tests for src/governance.ts - Agent governance dashboard
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  loadGovernanceData,
  computeFleetOverview,
  generateGovernanceDashboard,
  formatGovernance,
  type AgentReport,
  type GovernanceData,
} from '../src/governance';

function makeReport(overrides: Partial<AgentReport> = {}): AgentReport {
  return {
    agent: 'test-agent',
    timestamp: '2026-01-15T10:00:00Z',
    status: 'active',
    passed: 8,
    failed: 2,
    total: 10,
    cost_usd: 1.5,
    safety_score: 85,
    sla_compliance: 95,
    latency_avg_ms: 200,
    issues: [],
    recommendations: [],
    ...overrides,
  };
}

describe('Governance', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'governance-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('loadGovernanceData', () => {
    it('should return empty reports for nonexistent directory', () => {
      const data = loadGovernanceData('/nonexistent/path');
      expect(data.reports).toHaveLength(0);
      expect(data.generated_at).toBeDefined();
    });

    it('should load JSON reports', () => {
      const report = makeReport({ agent: 'agent-1' });
      fs.writeFileSync(path.join(tmpDir, 'report.json'), JSON.stringify(report));
      const data = loadGovernanceData(tmpDir);
      expect(data.reports).toHaveLength(1);
      expect(data.reports[0].agent).toBe('agent-1');
    });

    it('should load YAML reports', () => {
      const yaml = `agent: agent-2\nstatus: active\npassed: 5\nfailed: 1\ntotal: 6\ncost_usd: 0.5\nsafety_score: 90\nsla_compliance: 99\nlatency_avg_ms: 100`;
      fs.writeFileSync(path.join(tmpDir, 'report.yaml'), yaml);
      const data = loadGovernanceData(tmpDir);
      expect(data.reports).toHaveLength(1);
      expect(data.reports[0].agent).toBe('agent-2');
    });

    it('should load array format reports', () => {
      const reports = [makeReport({ agent: 'a1' }), makeReport({ agent: 'a2' })];
      fs.writeFileSync(path.join(tmpDir, 'reports.json'), JSON.stringify(reports));
      const data = loadGovernanceData(tmpDir);
      expect(data.reports).toHaveLength(2);
    });

    it('should load object with reports field', () => {
      const wrapper = { reports: [makeReport({ agent: 'a1' })] };
      fs.writeFileSync(path.join(tmpDir, 'reports.json'), JSON.stringify(wrapper));
      const data = loadGovernanceData(tmpDir);
      expect(data.reports).toHaveLength(1);
    });

    it('should skip invalid files', () => {
      fs.writeFileSync(path.join(tmpDir, 'bad.json'), 'not valid json{{{');
      const data = loadGovernanceData(tmpDir);
      expect(data.reports).toHaveLength(0);
    });

    it('should normalize missing fields with defaults', () => {
      fs.writeFileSync(path.join(tmpDir, 'minimal.json'), JSON.stringify({ name: 'bot' }));
      const data = loadGovernanceData(tmpDir);
      expect(data.reports[0].agent).toBe('bot');
      expect(data.reports[0].cost_usd).toBe(0);
      expect(data.reports[0].safety_score).toBe(100);
    });
  });

  describe('computeFleetOverview', () => {
    it('should compute overview from reports', () => {
      const data: GovernanceData = {
        reports: [
          makeReport({ agent: 'a1', status: 'active', passed: 10, failed: 0, total: 10 }),
          makeReport({ agent: 'a2', status: 'error', passed: 5, failed: 5, total: 10 }),
        ],
        generated_at: '2026-01-15T10:00:00Z',
      };
      const overview = computeFleetOverview(data);

      expect(overview.totalAgents).toBe(2);
      expect(overview.activeAgents).toBe(1);
      expect(overview.errorAgents).toBe(1);
      expect(overview.totalTests).toBe(20);
      expect(overview.totalPassed).toBe(15);
      expect(overview.totalFailed).toBe(5);
    });

    it('should use latest report per agent', () => {
      const data: GovernanceData = {
        reports: [
          makeReport({ agent: 'a1', timestamp: '2026-01-01T00:00:00Z', passed: 5 }),
          makeReport({ agent: 'a1', timestamp: '2026-01-02T00:00:00Z', passed: 10 }),
        ],
        generated_at: '2026-01-15T10:00:00Z',
      };
      const overview = computeFleetOverview(data);
      expect(overview.totalAgents).toBe(1);
      expect(overview.totalPassed).toBe(10);
    });

    it('should handle empty data', () => {
      const overview = computeFleetOverview({ reports: [], generated_at: '' });
      expect(overview.totalAgents).toBe(0);
      expect(overview.avgSafetyScore).toBe(0);
    });
  });

  describe('generateGovernanceDashboard', () => {
    it('should generate valid HTML', () => {
      const data: GovernanceData = {
        reports: [makeReport({ agent: 'agent-1', issues: ['slow response'], recommendations: ['add caching'] })],
        generated_at: '2026-01-15T10:00:00Z',
      };
      const html = generateGovernanceDashboard(data);

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Governance Dashboard');
      expect(html).toContain('agent-1');
      expect(html).toContain('slow response');
      expect(html).toContain('add caching');
    });

    it('should handle empty reports', () => {
      const html = generateGovernanceDashboard({ reports: [], generated_at: '' });
      expect(html).toContain('<!DOCTYPE html>');
    });

    it('should escape HTML entities in agent names', () => {
      const data: GovernanceData = {
        reports: [makeReport({ agent: '<script>alert("xss")</script>' })],
        generated_at: '2026-01-15T10:00:00Z',
      };
      const html = generateGovernanceDashboard(data);
      expect(html).not.toContain('<script>alert');
      expect(html).toContain('&lt;script&gt;');
    });
  });

  describe('formatGovernance', () => {
    it('should format governance data for console', () => {
      const data: GovernanceData = {
        reports: [
          makeReport({ agent: 'agent-1', status: 'active', issues: ['latency high'], recommendations: ['scale up'] }),
        ],
        generated_at: '2026-01-15T10:00:00Z',
      };
      const output = formatGovernance(data);

      expect(output).toContain('🏛️');
      expect(output).toContain('agent-1');
      expect(output).toContain('latency high');
      expect(output).toContain('scale up');
    });

    it('should show per-agent status icons', () => {
      const data: GovernanceData = {
        reports: [
          makeReport({ agent: 'good', status: 'active' }),
          makeReport({ agent: 'bad', status: 'error' }),
          makeReport({ agent: 'idle', status: 'inactive' }),
        ],
        generated_at: '',
      };
      const output = formatGovernance(data);
      expect(output).toContain('✅');
      expect(output).toContain('❌');
      expect(output).toContain('⏸️');
    });
  });
});
