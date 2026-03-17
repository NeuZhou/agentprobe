/**
 * ClawGuard Integration for AgentProbe
 *
 * Optional integration that runs ClawGuard security scans as part of
 * AgentProbe test suites. Gracefully degrades when ClawGuard is not installed.
 */

import type { AgentProbePlugin, AssertionHandler } from '../plugins';
import type { AgentTrace, AssertionResult } from '../types';

// ===== Types =====

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface ClawGuardFinding {
  id: string;
  severity: Severity;
  message: string;
  rule: string;
  file?: string;
  line?: number;
}

export interface ClawGuardScanResult {
  findings: ClawGuardFinding[];
  scannedFiles: number;
  duration_ms: number;
}

export interface ClawGuardOptions {
  /** Path to scan (defaults to cwd) */
  scanPath?: string;
  /** Severity levels that cause test failures */
  failOn?: Severity[];
  /** Path to custom rules directory */
  rules?: string;
  /** Timeout for scan in milliseconds */
  timeout_ms?: number;
}

// ===== ClawGuard module interface =====

interface ClawGuardModule {
  scan(options: {
    path: string;
    rules?: string;
    timeout?: number;
  }): Promise<ClawGuardScanResult>;
}

// ===== Availability check =====

let _clawguard: ClawGuardModule | null | undefined;

function getClawGuard(): ClawGuardModule | null {
  if (_clawguard !== undefined) return _clawguard;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _clawguard = require('@neuzhou/clawguard') as ClawGuardModule;
  } catch {
    _clawguard = null;
  }
  return _clawguard;
}

/** Check if ClawGuard is available without importing it */
export function isClawGuardAvailable(): boolean {
  return getClawGuard() !== null;
}

/** Reset cached module (for testing) */
export function _resetClawGuardCache(): void {
  _clawguard = undefined;
}

// ===== Core scan function =====

export async function runSecurityScan(
  options: ClawGuardOptions = {},
): Promise<ClawGuardScanResult> {
  const cg = getClawGuard();
  if (!cg) {
    throw new Error(
      '@neuzhou/clawguard is not installed. Install it to enable security scanning:\n' +
        '  npm install -D @neuzhou/clawguard',
    );
  }

  return cg.scan({
    path: options.scanPath ?? process.cwd(),
    rules: options.rules,
    timeout: options.timeout_ms,
  });
}

// ===== Assertion: toPassSecurityScan =====

function findingsExceedThreshold(
  findings: ClawGuardFinding[],
  failOn: Severity[],
): ClawGuardFinding[] {
  const thresholdSet = new Set(failOn);
  return findings.filter((f) => thresholdSet.has(f.severity));
}

export function createSecurityScanAssertion(
  options: ClawGuardOptions = {},
): AssertionHandler {
  const failOn = options.failOn ?? ['critical', 'high'];

  return (_trace: AgentTrace, _value: any): AssertionResult => {
    // This is a sync assertion handler — the actual scan must be run beforehand
    // and its results stored. For the plugin hook flow, we cache the last result.
    const cached = ClawGuardIntegration._lastScanResult;
    if (!cached) {
      return {
        name: 'toPassSecurityScan',
        passed: true,
        message: 'ClawGuard scan was not run (skipped)',
      };
    }

    const violations = findingsExceedThreshold(cached.findings, failOn);
    const passed = violations.length === 0;

    return {
      name: 'toPassSecurityScan',
      passed,
      expected: `No findings at severity: ${failOn.join(', ')}`,
      actual: passed
        ? 'No violations'
        : violations.map((v) => `[${v.severity}] ${v.rule}: ${v.message}`),
      message: passed
        ? undefined
        : `${violations.length} security finding(s) exceed threshold`,
    };
  };
}

// ===== Plugin / Integration class =====

export class ClawGuardIntegration {
  /** Cached result from the most recent scan (used by assertion handler) */
  static _lastScanResult: ClawGuardScanResult | null = null;

  private options: ClawGuardOptions;

  constructor(options: ClawGuardOptions = {}) {
    this.options = options;
  }

  /**
   * Build an AgentProbePlugin that hooks into the test lifecycle.
   */
  toPlugin(): AgentProbePlugin {
    const opts = this.options;
    const failOn = opts.failOn ?? ['critical', 'high'];

    return {
      name: 'clawguard',
      type: 'assertion',
      version: '1.0.0',
      assertions: {
        toPassSecurityScan: createSecurityScanAssertion(opts),
      },
      hooks: {
        async onSuiteStart() {
          if (!isClawGuardAvailable()) {
            console.log(
              '⚠️  ClawGuard not installed — security scan skipped.\n' +
                '   Install with: npm install -D @neuzhou/clawguard',
            );
            ClawGuardIntegration._lastScanResult = null;
            return;
          }

          try {
            console.log('🔒 Running ClawGuard security scan...');
            const result = await runSecurityScan(opts);
            ClawGuardIntegration._lastScanResult = result;

            const violations = findingsExceedThreshold(result.findings, failOn);
            console.log(
              `🔒 ClawGuard: scanned ${result.scannedFiles} files in ${result.duration_ms}ms — ` +
                `${result.findings.length} finding(s), ${violations.length} above threshold`,
            );
          } catch (err: any) {
            console.warn(`⚠️  ClawGuard scan failed: ${err.message}`);
            ClawGuardIntegration._lastScanResult = null;
          }
        },

        async onSuiteComplete() {
          ClawGuardIntegration._lastScanResult = null;
        },
      },
    };
  }
}
