import type { SuiteResult } from './types';

export type WebhookFormat = 'slack' | 'teams' | 'discord' | 'generic';
export type WebhookEvent = 'on_failure' | 'on_regression' | 'on_success' | 'on_complete';

export interface WebhookConfig {
  url: string;
  format?: WebhookFormat;
  headers?: Record<string, string>;
}

export interface WebhooksConfig {
  on_failure?: WebhookConfig;
  on_regression?: WebhookConfig;
  on_success?: WebhookConfig;
  on_complete?: WebhookConfig;
}

export interface WebhookPayload {
  event: WebhookEvent;
  suite: string;
  passed: number;
  failed: number;
  total: number;
  duration_ms: number;
  timestamp: string;
  failures?: Array<{ name: string; error?: string }>;
  regressions?: string[];
}

/**
 * Build a webhook payload from suite results.
 */
export function buildPayload(
  event: WebhookEvent,
  result: SuiteResult,
  extra?: { regressions?: string[] },
): WebhookPayload {
  return {
    event,
    suite: result.name,
    passed: result.passed,
    failed: result.failed,
    total: result.total,
    duration_ms: result.duration_ms,
    timestamp: new Date().toISOString(),
    failures: result.results
      .filter(r => !r.passed)
      .map(r => ({ name: r.name, error: r.error })),
    regressions: extra?.regressions,
  };
}

/**
 * Format a payload for a specific webhook platform.
 */
export function formatWebhookPayload(payload: WebhookPayload, format: WebhookFormat): string {
  switch (format) {
    case 'slack':
      return JSON.stringify(formatSlack(payload));
    case 'teams':
      return JSON.stringify(formatTeams(payload));
    case 'discord':
      return JSON.stringify(formatDiscord(payload));
    default:
      return JSON.stringify(payload);
  }
}

function formatSlack(p: WebhookPayload) {
  const icon = p.failed > 0 ? '❌' : '✅';
  const blocks: any[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${icon} *AgentProbe: ${p.suite}*\n${p.passed}/${p.total} passed (${p.duration_ms}ms)`,
      },
    },
  ];

  if (p.failures && p.failures.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Failures:*\n${p.failures.map(f => `• ${f.name}${f.error ? ': ' + f.error : ''}`).join('\n')}`,
      },
    });
  }

  if (p.regressions && p.regressions.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Regressions:*\n${p.regressions.map(r => `• ${r}`).join('\n')}`,
      },
    });
  }

  return { blocks };
}

function formatTeams(p: WebhookPayload) {
  return {
    '@type': 'MessageCard',
    themeColor: p.failed > 0 ? 'FF0000' : '00FF00',
    summary: `AgentProbe: ${p.suite}`,
    sections: [
      {
        activityTitle: `AgentProbe: ${p.suite}`,
        facts: [
          { name: 'Passed', value: `${p.passed}/${p.total}` },
          { name: 'Failed', value: `${p.failed}` },
          { name: 'Duration', value: `${p.duration_ms}ms` },
        ],
      },
    ],
  };
}

function formatDiscord(p: WebhookPayload) {
  const icon = p.failed > 0 ? '❌' : '✅';
  return {
    embeds: [
      {
        title: `${icon} AgentProbe: ${p.suite}`,
        color: p.failed > 0 ? 0xFF0000 : 0x00FF00,
        fields: [
          { name: 'Passed', value: `${p.passed}/${p.total}`, inline: true },
          { name: 'Failed', value: `${p.failed}`, inline: true },
          { name: 'Duration', value: `${p.duration_ms}ms`, inline: true },
        ],
        timestamp: p.timestamp,
      },
    ],
  };
}

/**
 * Send a webhook notification (returns the response status).
 */
export async function sendWebhook(
  config: WebhookConfig,
  payload: WebhookPayload,
): Promise<{ success: boolean; status?: number; error?: string }> {
  const format = config.format ?? 'generic';
  const body = formatWebhookPayload(payload, format);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...config.headers,
  };

  try {
    const res = await fetch(config.url, {
      method: 'POST',
      headers,
      body,
    });
    return { success: res.ok, status: res.status };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * Trigger webhooks based on suite results and configured events.
 */
export async function triggerWebhooks(
  webhooks: WebhooksConfig,
  result: SuiteResult,
  extra?: { regressions?: string[] },
): Promise<void> {
  const events: WebhookEvent[] = [];

  if (result.failed > 0) events.push('on_failure');
  if (result.failed === 0) events.push('on_success');
  events.push('on_complete');
  if (extra?.regressions && extra.regressions.length > 0) events.push('on_regression');

  for (const event of events) {
    const config = webhooks[event];
    if (!config) continue;
    const payload = buildPayload(event, result, extra);
    await sendWebhook(config, payload);
  }
}
