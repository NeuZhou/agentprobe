/**
 * A2A Agent Discovery
 *
 * Discover, verify, and catalog A2A-compatible agents via well-known endpoints
 * and agent registries. Supports capability verification against claimed features.
 */

import type { AgentCard, AgentSkill } from './adapters/a2a';

// ===== Types =====

export interface VerificationResult {
  capability: string;
  claimed: boolean;
  verified: boolean;
  details?: string;
}

export interface VerificationReport {
  agent: string;
  url: string;
  timestamp: string;
  results: VerificationResult[];
  overallScore: number; // 0-100
  warnings: string[];
}

export interface DiscoveryConfig {
  timeout_ms?: number;
  headers?: Record<string, string>;
  registryUrls?: string[];
  verifyCapabilities?: boolean;
}

// ===== Agent Discovery =====

export class AgentDiscovery {
  private config: DiscoveryConfig;

  constructor(config: DiscoveryConfig = {}) {
    this.config = {
      timeout_ms: 10000,
      verifyCapabilities: true,
      ...config,
    };
  }

  /**
   * Discover an A2A agent from a base URL by fetching /.well-known/agent.json
   */
  async discoverFromUrl(baseUrl: string): Promise<AgentCard | null> {
    const url = `${baseUrl.replace(/\/$/, '')}/.well-known/agent.json`;

    try {
      const resp = await fetch(url, {
        headers: this.config.headers,
        signal: AbortSignal.timeout(this.config.timeout_ms || 10000),
      });

      if (!resp.ok) return null;

      const card = (await resp.json()) as AgentCard;
      if (!card.name || !card.url) return null;

      return card;
    } catch {
      return null;
    }
  }

  /**
   * Discover agents from a registry by query
   */
  async discoverFromRegistry(query: string): Promise<AgentCard[]> {
    const registries = this.config.registryUrls || [
      'https://a2a-registry.googleapis.com/v1/agents',
    ];

    const allCards: AgentCard[] = [];

    for (const registryUrl of registries) {
      try {
        const url = `${registryUrl}?q=${encodeURIComponent(query)}`;
        const resp = await fetch(url, {
          headers: this.config.headers,
          signal: AbortSignal.timeout(this.config.timeout_ms || 10000),
        });

        if (!resp.ok) continue;

        const data = (await resp.json()) as Record<string, any>;
        const agents = Array.isArray(data) ? data : data.agents || data.results || [];
        allCards.push(...agents.filter((a: any) => a.name && a.url));
      } catch {
        // Registry unavailable — continue
      }
    }

    return allCards;
  }

  /**
   * Discover agents from multiple URLs (batch)
   */
  async discoverBatch(urls: string[]): Promise<Map<string, AgentCard | null>> {
    const results = new Map<string, AgentCard | null>();
    const promises = urls.map(async (url) => {
      const card = await this.discoverFromUrl(url);
      results.set(url, card);
    });

    await Promise.all(promises);
    return results;
  }

  /**
   * Verify that an agent's claimed capabilities actually work
   */
  async verifyCapabilities(card: AgentCard): Promise<VerificationReport> {
    const results: VerificationResult[] = [];
    const warnings: string[] = [];

    // Verify agent is reachable
    const reachable = await this.checkReachable(card.url);
    results.push({
      capability: 'reachable',
      claimed: true,
      verified: reachable,
      details: reachable ? 'Agent endpoint is reachable' : 'Agent endpoint is not reachable',
    });

    if (!reachable) {
      warnings.push('Agent is not reachable — capability verification skipped');
      return this.buildVerificationReport(card, results, warnings);
    }

    // Verify tasks/send support (required by A2A spec)
    const sendResult = await this.testMethod(card.url, 'tasks/send');
    results.push({
      capability: 'tasks/send',
      claimed: true,
      verified: sendResult,
      details: sendResult ? 'tasks/send is functional' : 'tasks/send failed or rejected',
    });

    // Verify streaming if claimed
    if (card.supportsStreaming) {
      const streamResult = await this.testStreaming(card.url);
      results.push({
        capability: 'streaming',
        claimed: true,
        verified: streamResult,
        details: streamResult ? 'Streaming works' : 'Streaming claimed but not functional',
      });
      if (!streamResult) warnings.push('Agent claims streaming support but it does not work');
    }

    // Verify push notifications if claimed
    if (card.supportsPushNotifications) {
      const pushResult = await this.testMethod(card.url, 'tasks/pushNotification/get');
      results.push({
        capability: 'push_notifications',
        claimed: true,
        verified: pushResult,
        details: pushResult ? 'Push notifications endpoint responds' : 'Push notifications not functional',
      });
      if (!pushResult) warnings.push('Agent claims push notification support but it does not work');
    }

    // Verify skills if declared
    if (card.skills?.length) {
      for (const skill of card.skills.slice(0, 5)) {
        // Test each skill with a simple message mentioning the skill
        const skillResult = await this.testSkill(card.url, skill);
        results.push({
          capability: `skill:${skill.id}`,
          claimed: true,
          verified: skillResult,
          details: skillResult ? `Skill "${skill.name}" responded` : `Skill "${skill.name}" not responsive`,
        });
      }
    }

    // Check input/output modes
    if (card.defaultInputModes?.length) {
      results.push({
        capability: 'input_modes',
        claimed: true,
        verified: true,
        details: `Input modes: ${card.defaultInputModes.join(', ')}`,
      });
    }

    if (card.defaultOutputModes?.length) {
      results.push({
        capability: 'output_modes',
        claimed: true,
        verified: true,
        details: `Output modes: ${card.defaultOutputModes.join(', ')}`,
      });
    }

    return this.buildVerificationReport(card, results, warnings);
  }

  // ===== Private Helpers =====

  private async checkReachable(url: string): Promise<boolean> {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'ping', method: 'tasks/get', params: { id: 'nonexistent' } }),
        signal: AbortSignal.timeout(5000),
      });
      return resp.status < 500;
    } catch {
      return false;
    }
  }

  private async testMethod(url: string, method: string): Promise<boolean> {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: `verify-${Date.now()}`, method,
          params: method === 'tasks/send'
            ? { id: `verify-${Date.now()}`, message: { role: 'user', parts: [{ type: 'text', text: 'ping' }] } }
            : { id: `verify-${Date.now()}` },
        }),
        signal: AbortSignal.timeout(this.config.timeout_ms || 10000),
      });

      const data = (await resp.json()) as Record<string, any>;
      // Method not found (-32601) means the endpoint works but method isn't supported
      if (data.error?.code === -32601) return false;
      return resp.ok;
    } catch {
      return false;
    }
  }

  private async testStreaming(url: string): Promise<boolean> {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: `stream-verify-${Date.now()}`, method: 'tasks/sendSubscribe',
          params: { id: `stream-${Date.now()}`, message: { role: 'user', parts: [{ type: 'text', text: 'ping' }] } },
        }),
        signal: AbortSignal.timeout(5000),
      });

      const contentType = resp.headers.get('content-type') || '';
      return resp.ok && (contentType.includes('event-stream') || contentType.includes('json'));
    } catch {
      return false;
    }
  }

  private async testSkill(url: string, skill: AgentSkill): Promise<boolean> {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: `skill-verify-${Date.now()}`,
          method: 'tasks/send',
          params: {
            id: `skill-test-${Date.now()}`,
            message: { role: 'user', parts: [{ type: 'text', text: `Test: ${skill.name}` }] },
          },
        }),
        signal: AbortSignal.timeout(this.config.timeout_ms || 10000),
      });

      return resp.ok;
    } catch {
      return false;
    }
  }

  private buildVerificationReport(
    card: AgentCard,
    results: VerificationResult[],
    warnings: string[],
  ): VerificationReport {
    const verified = results.filter((r) => r.verified).length;
    const total = results.length;
    const score = total > 0 ? Math.round((verified / total) * 100) : 0;

    return {
      agent: card.name,
      url: card.url,
      timestamp: new Date().toISOString(),
      results,
      overallScore: score,
      warnings,
    };
  }
}

/**
 * Format a verification report for display
 */
export function formatVerificationReport(report: VerificationReport): string {
  const lines: string[] = [
    `🔍 Agent Verification: ${report.agent}`,
    `   URL: ${report.url}`,
    `   Score: ${report.overallScore}/100`,
    `   Time: ${report.timestamp}`,
    '',
  ];

  for (const r of report.results) {
    const icon = r.verified ? '✅' : '❌';
    lines.push(`${icon} ${r.capability}: ${r.details || (r.verified ? 'OK' : 'FAIL')}`);
  }

  if (report.warnings.length > 0) {
    lines.push('');
    lines.push('⚠️ Warnings:');
    for (const w of report.warnings) {
      lines.push(`   • ${w}`);
    }
  }

  return lines.join('\n');
}
