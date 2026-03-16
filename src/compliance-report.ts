/**
 * Agent Compliance Reports — Generate compliance reports for regulated industries.
 * Supports: SOC2, HIPAA, GDPR, PCI-DSS (simplified checks).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { AgentTrace } from './types';

export type ComplianceStandard = 'soc2' | 'hipaa' | 'gdpr' | 'pci-dss';

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface ComplianceCheck {
  id: string;
  name: string;
  status: CheckStatus;
  detail: string;
}

export interface ComplianceReport {
  standard: ComplianceStandard;
  timestamp: string;
  checks: ComplianceCheck[];
  summary: { pass: number; warn: number; fail: number };
}

interface TraceData {
  traces: AgentTrace[];
  hasAuditLog: boolean;
  hasEncryptedKeys: boolean;
  hasRBAC: boolean;
  hasVersionControl: boolean;
  hasPII: boolean;
  hasDataRetention: boolean;
  hasConsentTracking: boolean;
  hasAccessLogging: boolean;
  hasTokenMasking: boolean;
}

/**
 * Analyze trace data from a directory.
 */
export function analyzeTraceData(dataDir: string): TraceData {
  const traces: AgentTrace[] = [];
  const files = fs.existsSync(dataDir) ? fs.readdirSync(dataDir) : [];

  for (const file of files) {
    if (file.endsWith('.json')) {
      try {
        const content = fs.readFileSync(path.join(dataDir, file), 'utf-8');
        traces.push(JSON.parse(content));
      } catch { /* skip invalid */ }
    }
  }

  const allContent = traces
    .flatMap((t) => t.steps.map((s) => JSON.stringify(s.data)))
    .join(' ');

  return {
    traces,
    hasAuditLog: traces.some((t) => t.steps.length > 0 && t.metadata?.audit !== false),
    hasEncryptedKeys: !allContent.match(/sk-[a-zA-Z0-9]{20,}|AKIA[A-Z0-9]{16}/),
    hasRBAC: traces.some((t) => t.metadata?.rbac === true || t.metadata?.roles != null),
    hasVersionControl: traces.some((t) => t.metadata?.version != null),
    hasPII: !!allContent.match(/\b\d{3}-\d{2}-\d{4}\b|\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/i),
    hasDataRetention: traces.some((t) => t.metadata?.retention != null),
    hasConsentTracking: traces.some((t) => t.metadata?.consent != null),
    hasAccessLogging: traces.some((t) => t.metadata?.access_log === true),
    hasTokenMasking: !allContent.match(/Bearer [a-zA-Z0-9._-]{20,}/),
  };
}

/**
 * Analyze in-memory trace data (no file system).
 */
export function analyzeTraces(traces: AgentTrace[]): TraceData {
  const allContent = traces
    .flatMap((t) => t.steps.map((s) => JSON.stringify(s.data)))
    .join(' ');

  return {
    traces,
    hasAuditLog: traces.some((t) => t.steps.length > 0 && t.metadata?.audit !== false),
    hasEncryptedKeys: !allContent.match(/sk-[a-zA-Z0-9]{20,}|AKIA[A-Z0-9]{16}/),
    hasRBAC: traces.some((t) => t.metadata?.rbac === true || t.metadata?.roles != null),
    hasVersionControl: traces.some((t) => t.metadata?.version != null),
    hasPII: !!allContent.match(/\b\d{3}-\d{2}-\d{4}\b|\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/i),
    hasDataRetention: traces.some((t) => t.metadata?.retention != null),
    hasConsentTracking: traces.some((t) => t.metadata?.consent != null),
    hasAccessLogging: traces.some((t) => t.metadata?.access_log === true),
    hasTokenMasking: !allContent.match(/Bearer [a-zA-Z0-9._-]{20,}/),
  };
}

// ===== Standard-specific checks =====

function soc2Checks(data: TraceData): ComplianceCheck[] {
  return [
    {
      id: 'CC6.1',
      name: 'Logical Access',
      status: data.hasEncryptedKeys ? 'pass' : 'fail',
      detail: data.hasEncryptedKeys ? 'API keys encrypted / not exposed' : 'API keys found in plaintext',
    },
    {
      id: 'CC6.3',
      name: 'Role-based Access',
      status: data.hasRBAC ? 'pass' : 'warn',
      detail: data.hasRBAC ? 'RBAC configured in traces' : 'No RBAC in tool access',
    },
    {
      id: 'CC7.2',
      name: 'System Monitoring',
      status: data.hasAuditLog ? 'pass' : 'fail',
      detail: data.hasAuditLog ? 'Full audit logging' : 'No audit logging found',
    },
    {
      id: 'CC8.1',
      name: 'Change Management',
      status: data.hasVersionControl ? 'pass' : 'warn',
      detail: data.hasVersionControl ? 'Version control in traces' : 'No version tracking found',
    },
  ];
}

function hipaaChecks(data: TraceData): ComplianceCheck[] {
  return [
    {
      id: 'PHI-1',
      name: 'PHI Exposure',
      status: data.hasPII ? 'fail' : 'pass',
      detail: data.hasPII ? 'PII/PHI detected in trace data' : 'No PII/PHI detected',
    },
    {
      id: 'PHI-2',
      name: 'Access Controls',
      status: data.hasRBAC ? 'pass' : 'fail',
      detail: data.hasRBAC ? 'Access controls configured' : 'No access controls found',
    },
    {
      id: 'PHI-3',
      name: 'Audit Trail',
      status: data.hasAuditLog ? 'pass' : 'fail',
      detail: data.hasAuditLog ? 'Audit trail present' : 'No audit trail',
    },
    {
      id: 'PHI-4',
      name: 'Data Encryption',
      status: data.hasEncryptedKeys && data.hasTokenMasking ? 'pass' : 'warn',
      detail: data.hasEncryptedKeys ? 'Encryption indicators present' : 'Encryption not verified',
    },
  ];
}

function gdprChecks(data: TraceData): ComplianceCheck[] {
  return [
    {
      id: 'GDPR-1',
      name: 'Data Minimization',
      status: data.hasPII ? 'warn' : 'pass',
      detail: data.hasPII ? 'Personal data found in traces' : 'No personal data in traces',
    },
    {
      id: 'GDPR-2',
      name: 'Consent Tracking',
      status: data.hasConsentTracking ? 'pass' : 'fail',
      detail: data.hasConsentTracking ? 'Consent tracked' : 'No consent tracking found',
    },
    {
      id: 'GDPR-3',
      name: 'Data Retention',
      status: data.hasDataRetention ? 'pass' : 'warn',
      detail: data.hasDataRetention ? 'Retention policy defined' : 'No retention policy',
    },
    {
      id: 'GDPR-4',
      name: 'Access Logging',
      status: data.hasAccessLogging ? 'pass' : 'warn',
      detail: data.hasAccessLogging ? 'Access logging enabled' : 'No access logging',
    },
  ];
}

function pciDssChecks(data: TraceData): ComplianceCheck[] {
  return [
    {
      id: 'PCI-1',
      name: 'Cardholder Data',
      status: data.hasPII ? 'fail' : 'pass',
      detail: data.hasPII ? 'Sensitive data patterns detected' : 'No cardholder data patterns',
    },
    {
      id: 'PCI-2',
      name: 'Token Masking',
      status: data.hasTokenMasking ? 'pass' : 'fail',
      detail: data.hasTokenMasking ? 'Tokens properly masked' : 'Unmasked tokens found',
    },
    {
      id: 'PCI-3',
      name: 'Encryption',
      status: data.hasEncryptedKeys ? 'pass' : 'fail',
      detail: data.hasEncryptedKeys ? 'Keys encrypted' : 'Unencrypted keys found',
    },
    {
      id: 'PCI-4',
      name: 'Audit Logging',
      status: data.hasAuditLog ? 'pass' : 'fail',
      detail: data.hasAuditLog ? 'Audit logging enabled' : 'No audit logging',
    },
  ];
}

/**
 * Generate a compliance report for a given standard.
 */
export function generateComplianceReport(
  standard: ComplianceStandard,
  data: TraceData,
): ComplianceReport {
  let checks: ComplianceCheck[];

  switch (standard) {
    case 'soc2': checks = soc2Checks(data); break;
    case 'hipaa': checks = hipaaChecks(data); break;
    case 'gdpr': checks = gdprChecks(data); break;
    case 'pci-dss': checks = pciDssChecks(data); break;
    default: throw new Error(`Unknown standard: ${standard}`);
  }

  const summary = { pass: 0, warn: 0, fail: 0 };
  for (const c of checks) {
    summary[c.status]++;
  }

  return {
    standard,
    timestamp: new Date().toISOString(),
    checks,
    summary,
  };
}

/**
 * Format a compliance report for console output.
 */
export function formatComplianceReport(report: ComplianceReport): string {
  const icons: Record<CheckStatus, string> = { pass: '✅', warn: '⚠️', fail: '❌' };
  const title = report.standard.toUpperCase();
  const lines: string[] = ['', `📋 ${title} Compliance Report`, ''];

  for (const check of report.checks) {
    const status = icons[check.status] ?? '?';
    lines.push(`  ${check.id} (${check.name}): ${status} ${check.status.toUpperCase()} — ${check.detail}`);
  }

  lines.push('');
  lines.push(`  Summary: ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail`);
  lines.push('');
  return lines.join('\n');
}

/**
 * List supported compliance standards.
 */
export function listStandards(): ComplianceStandard[] {
  return ['soc2', 'hipaa', 'gdpr', 'pci-dss'];
}
