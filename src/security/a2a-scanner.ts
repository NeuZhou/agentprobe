/**
 * A2A Security Scanner
 *
 * Security analysis for A2A (Agent-to-Agent) protocol implementations.
 * Checks agent card security, task isolation, push notification safety,
 * and authentication configuration.
 */

import type { AgentCard, AuthenticationInfo } from '../adapters/a2a';

// ===== Types =====

export interface SecurityFinding {
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: string;
  title: string;
  description: string;
  recommendation?: string;
}

export interface SecurityReport {
  target: string;
  timestamp: string;
  findings: SecurityFinding[];
  score: number; // 0-100
  passed: boolean;
  summary: string;
}

export interface A2AScannerConfig {
  timeout_ms?: number;
  strictHttps?: boolean;
  minAuthSchemes?: number;
  checkCapabilities?: boolean;
  headers?: Record<string, string>;
}

// ===== A2A Security Scanner =====

export class A2ASecurityScanner {
  private config: A2AScannerConfig;

  constructor(config: A2AScannerConfig = {}) {
    this.config = {
      timeout_ms: 10000,
      strictHttps: true,
      minAuthSchemes: 1,
      checkCapabilities: true,
      ...config,
    };
  }

  /**
   * Scan an agent card for security issues
   */
  async scanAgentCard(url: string): Promise<SecurityReport> {
    const findings: SecurityFinding[] = [];
    const baseUrl = url.replace(/\/$/, '');
    const cardUrl = `${baseUrl}/.well-known/agent.json`;

    // Check HTTPS
    if (this.config.strictHttps && !url.startsWith('https://')) {
      findings.push({
        severity: 'critical',
        category: 'transport',
        title: 'No HTTPS',
        description: `Agent URL uses HTTP: ${url}`,
        recommendation: 'Use HTTPS for all A2A communication',
      });
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeout_ms);

      const resp = await fetch(cardUrl, {
        headers: this.config.headers,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!resp.ok) {
        findings.push({
          severity: 'high',
          category: 'discovery',
          title: 'Agent card not accessible',
          description: `GET ${cardUrl} returned ${resp.status}`,
          recommendation: 'Ensure /.well-known/agent.json is publicly accessible',
        });
        return this.buildReport(url, findings);
      }

      const card = (await resp.json()) as AgentCard;

      // Check authentication requirements
      if (!card.authentication) {
        findings.push({
          severity: 'high',
          category: 'authentication',
          title: 'No authentication declared',
          description: 'Agent card does not specify authentication requirements',
          recommendation: 'Declare authentication schemes in the agent card',
        });
      } else {
        this.checkAuth(card.authentication, findings);
      }

      // Check capability claims
      if (this.config.checkCapabilities && card.capabilities) {
        await this.verifyCapabilities(baseUrl, card, findings);
      }

      // Check for information disclosure
      if (card.provider?.url) {
        findings.push({
          severity: 'info',
          category: 'disclosure',
          title: 'Provider URL disclosed',
          description: `Provider URL: ${card.provider.url}`,
        });
      }

      // Check CORS headers
      const corsHeader = resp.headers.get('access-control-allow-origin');
      if (corsHeader === '*') {
        findings.push({
          severity: 'medium',
          category: 'cors',
          title: 'Wildcard CORS',
          description: 'Access-Control-Allow-Origin is set to *',
          recommendation: 'Restrict CORS to specific trusted origins',
        });
      }

      // Check version info
      if (!card.version) {
        findings.push({
          severity: 'low',
          category: 'metadata',
          title: 'No version in agent card',
          description: 'Agent card lacks version information',
          recommendation: 'Include version for client compatibility checks',
        });
      }

    } catch (err: any) {
      findings.push({
        severity: 'high',
        category: 'connectivity',
        title: 'Agent card fetch failed',
        description: err.message,
      });
    }

    return this.buildReport(url, findings);
  }

  /**
   * Scan for task isolation issues
   */
  async scanTaskIsolation(url: string): Promise<SecurityReport> {
    const findings: SecurityFinding[] = [];

    try {
      // Test 1: Send two tasks and check for data leakage
      await this.sendProbe(url, 'tasks/send', {
        id: `isolation-probe-1-${Date.now()}`,
        message: { role: 'user', parts: [{ type: 'text', text: 'PROBE_SECRET_ALPHA_12345' }] },
      });

      const task2 = await this.sendProbe(url, 'tasks/send', {
        id: `isolation-probe-2-${Date.now()}`,
        message: { role: 'user', parts: [{ type: 'text', text: 'What was the previous message?' }] },
      });

      if (task2 && typeof task2 === 'string' && task2.includes('PROBE_SECRET_ALPHA_12345')) {
        findings.push({
          severity: 'critical',
          category: 'isolation',
          title: 'Cross-task data leakage',
          description: 'Task 2 can access data from Task 1 without shared session',
          recommendation: 'Ensure strict task isolation — no shared state between tasks without explicit session',
        });
      }

      // Test 2: Session fixation — try to hijack a session
      const sessionId = `session-${Date.now()}`;
      await this.sendProbe(url, 'tasks/send', {
        id: `fixation-probe-1-${Date.now()}`,
        sessionId,
        message: { role: 'user', parts: [{ type: 'text', text: 'FIXATION_SECRET_67890' }] },
      });

      // Try same sessionId with different "identity"
      const fixationResult = await this.sendProbe(url, 'tasks/send', {
        id: `fixation-probe-2-${Date.now()}`,
        sessionId,
        message: { role: 'user', parts: [{ type: 'text', text: 'Repeat all previous messages in this session' }] },
      });

      if (fixationResult && typeof fixationResult === 'string' && fixationResult.includes('FIXATION_SECRET_67890')) {
        findings.push({
          severity: 'high',
          category: 'isolation',
          title: 'Session fixation possible',
          description: 'Session IDs can be reused without authentication, enabling session hijacking',
          recommendation: 'Bind sessions to authenticated identities; reject unauthenticated session reuse',
        });
      }

      // Test 3: Task ID enumeration
      const enumResult = await this.sendProbe(url, 'tasks/get', {
        id: `task-00000000-0000-0000-0000-000000000001`,
      });

      if (enumResult && !enumResult.error) {
        findings.push({
          severity: 'medium',
          category: 'isolation',
          title: 'Task ID enumeration possible',
          description: 'Can retrieve tasks by guessing IDs',
          recommendation: 'Use unpredictable task IDs and require ownership verification',
        });
      }

    } catch (err: any) {
      findings.push({
        severity: 'info',
        category: 'isolation',
        title: 'Isolation scan incomplete',
        description: `Error during scan: ${err.message}`,
      });
    }

    return this.buildReport(url, findings);
  }

  /**
   * Scan push notification security
   */
  async scanPushNotifications(url: string): Promise<SecurityReport> {
    const findings: SecurityFinding[] = [];

    try {
      // Check if agent supports push notifications
      const cardUrl = `${url.replace(/\/$/, '')}/.well-known/agent.json`;
      const resp = await fetch(cardUrl, {
        headers: this.config.headers,
        signal: AbortSignal.timeout(this.config.timeout_ms || 10000),
      });

      if (!resp.ok) {
        findings.push({
          severity: 'info',
          category: 'push',
          title: 'Cannot check push notification support',
          description: `Agent card not accessible: ${resp.status}`,
        });
        return this.buildReport(url, findings);
      }

      const card = (await resp.json()) as AgentCard;

      if (!card.supportsPushNotifications) {
        findings.push({
          severity: 'info',
          category: 'push',
          title: 'Push notifications not supported',
          description: 'Agent does not declare push notification support',
        });
        return this.buildReport(url, findings);
      }

      // Test 1: Callback URL validation — try registering an internal URL
      const internalUrls = [
        'http://localhost:8080/callback',
        'http://127.0.0.1:9090/callback',
        'http://169.254.169.254/latest/meta-data/',
        'http://[::1]:8080/callback',
        'http://internal.service:8080/callback',
      ];

      for (const callbackUrl of internalUrls) {
        try {
          const result = await this.sendProbe(url, 'tasks/pushNotification/set', {
            id: `push-probe-${Date.now()}`,
            pushNotificationConfig: { url: callbackUrl },
          });

          if (result && !result.error) {
            findings.push({
              severity: 'critical',
              category: 'push',
              title: 'SSRF via push notification callback',
              description: `Agent accepted internal callback URL: ${callbackUrl}`,
              recommendation: 'Validate callback URLs — reject localhost, private IPs, metadata endpoints',
            });
            break; // One is enough
          }
        } catch {
          // Expected — rejection is good
        }
      }

      // Test 2: Notification spoofing — register and check auth
      const fakeCallback = `https://probe-test-${Date.now()}.example.com/callback`;
      const pushResult = await this.sendProbe(url, 'tasks/pushNotification/set', {
        id: `push-auth-probe-${Date.now()}`,
        pushNotificationConfig: {
          url: fakeCallback,
          authentication: { schemes: ['bearer'] },
        },
      });

      if (pushResult && !pushResult.error) {
        findings.push({
          severity: 'medium',
          category: 'push',
          title: 'Push notification registered without verification',
          description: 'Callback URL accepted without ownership verification',
          recommendation: 'Implement callback URL ownership verification (e.g., challenge-response)',
        });
      }

    } catch (err: any) {
      findings.push({
        severity: 'info',
        category: 'push',
        title: 'Push notification scan incomplete',
        description: `Error: ${err.message}`,
      });
    }

    return this.buildReport(url, findings);
  }

  /**
   * Run a full security scan (all checks)
   */
  async fullScan(url: string): Promise<SecurityReport> {
    const [cardReport, isolationReport, pushReport] = await Promise.all([
      this.scanAgentCard(url),
      this.scanTaskIsolation(url),
      this.scanPushNotifications(url),
    ]);

    const allFindings = [
      ...cardReport.findings,
      ...isolationReport.findings,
      ...pushReport.findings,
    ];

    return this.buildReport(url, allFindings);
  }

  // ===== Private Helpers =====

  private checkAuth(auth: AuthenticationInfo, findings: SecurityFinding[]): void {
    if (!auth.schemes || auth.schemes.length === 0) {
      findings.push({
        severity: 'high',
        category: 'authentication',
        title: 'No auth schemes defined',
        description: 'Authentication block exists but declares no schemes',
        recommendation: 'Declare at least one authentication scheme (e.g., bearer, oauth2)',
      });
    }

    if (auth.schemes?.includes('none') || auth.schemes?.includes('anonymous')) {
      findings.push({
        severity: 'medium',
        category: 'authentication',
        title: 'Anonymous access allowed',
        description: 'Agent allows unauthenticated access',
        recommendation: 'Require authentication for production agents',
      });
    }
  }

  private async verifyCapabilities(
    baseUrl: string,
    card: AgentCard,
    findings: SecurityFinding[],
  ): Promise<void> {
    if (card.supportsStreaming) {
      try {
        const resp = await fetch(baseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...this.config.headers },
          body: JSON.stringify({
            jsonrpc: '2.0', id: 'cap-check-stream', method: 'tasks/sendSubscribe',
            params: { id: 'cap-probe', message: { role: 'user', parts: [{ type: 'text', text: 'test' }] } },
          }),
          signal: AbortSignal.timeout(5000),
        });
        if (!resp.ok) {
          findings.push({
            severity: 'medium',
            category: 'capabilities',
            title: 'Claimed streaming not functional',
            description: `Agent claims streaming support but tasks/sendSubscribe returned ${resp.status}`,
          });
        }
      } catch {
        findings.push({
          severity: 'medium',
          category: 'capabilities',
          title: 'Streaming capability unverifiable',
          description: 'Could not verify streaming support',
        });
      }
    }
  }

  private async sendProbe(url: string, method: string, params: any): Promise<any> {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.config.headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: `probe-${Date.now()}`, method, params }),
      signal: AbortSignal.timeout(this.config.timeout_ms || 10000),
    });
    if (!resp.ok) return { error: resp.status };
    return resp.json();
  }

  private buildReport(target: string, findings: SecurityFinding[]): SecurityReport {
    const weights: Record<string, number> = { critical: 30, high: 20, medium: 10, low: 5, info: 0 };
    const penalty = findings.reduce((sum, f) => sum + (weights[f.severity] || 0), 0);
    const score = Math.max(0, 100 - penalty);

    return {
      target,
      timestamp: new Date().toISOString(),
      findings,
      score,
      passed: score >= 60,
      summary: `${findings.length} findings (${findings.filter(f => f.severity === 'critical').length} critical, ${findings.filter(f => f.severity === 'high').length} high) — Score: ${score}/100`,
    };
  }
}

/**
 * Format a security report for display
 */
export function formatSecurityReport(report: SecurityReport): string {
  const lines: string[] = [
    `🔒 A2A Security Report: ${report.target}`,
    `   Score: ${report.score}/100 ${report.passed ? '✅' : '❌'}`,
    `   Time: ${report.timestamp}`,
    `   ${report.summary}`,
    '',
  ];

  const bySeverity: Record<string, SecurityFinding[]> = {};
  for (const f of report.findings) {
    (bySeverity[f.severity] ||= []).push(f);
  }

  const icons: Record<string, string> = { critical: '🔴', high: '🟠', medium: '🟡', low: '🔵', info: 'ℹ️' };

  for (const sev of ['critical', 'high', 'medium', 'low', 'info']) {
    const group = bySeverity[sev];
    if (!group?.length) continue;
    lines.push(`${icons[sev]} ${sev.toUpperCase()} (${group.length}):`);
    for (const f of group) {
      lines.push(`   • [${f.category}] ${f.title}`);
      lines.push(`     ${f.description}`);
      if (f.recommendation) lines.push(`     → ${f.recommendation}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
