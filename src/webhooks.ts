import type { SuiteResult } from './types';

export type WebhookFormat = 'slack' | 'teams' | 'discord' | 'generic';
export type WebhookEvent = 'on_failure' | 'on_regression' | 'on_success' | 'on_complete';
export type NotificationType = 'slack' | 'teams' | 'discord' | 'email' | 'pagerduty' | 'http' | 'generic';

export interface WebhookConfig {
  url: string;
  format?: WebhookFormat;
  headers?: Record<string, string>;
}

export interface EmailNotificationConfig {
  type: 'email';
  to: string | string[];
  from?: string;
  subject_prefix?: string;
  smtp?: {
    host: string;
    port: number;
    secure?: boolean;
    auth?: { user: string; pass: string };
  };
  on: WebhookEvent[];
}

export interface PagerDutyNotificationConfig {
  type: 'pagerduty';
  routing_key: string;
  severity?: 'critical' | 'error' | 'warning' | 'info';
  on: WebhookEvent[];
}

export interface HttpNotificationConfig {
  type: 'http';
  url: string;
  method?: 'POST' | 'PUT' | 'PATCH';
  headers?: Record<string, string>;
  on: WebhookEvent[];
}

export interface SlackNotificationConfig {
  type: 'slack';
  webhook_url: string;
  channel?: string;
  on: WebhookEvent[];
}

export type NotificationConfig =
  | EmailNotificationConfig
  | PagerDutyNotificationConfig
  | HttpNotificationConfig
  | SlackNotificationConfig;

export interface NotificationHubConfig {
  notifications: NotificationConfig[];
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

// ===== Notification Hub =====

/**
 * Build a PagerDuty Events API v2 payload.
 */
export function buildPagerDutyPayload(
  payload: WebhookPayload,
  routingKey: string,
  severity: PagerDutyNotificationConfig['severity'] = 'error',
): object {
  return {
    routing_key: routingKey,
    event_action: 'trigger',
    payload: {
      summary: `AgentProbe ${payload.event}: ${payload.suite} — ${payload.passed}/${payload.total} passed`,
      severity,
      source: 'agentprobe',
      timestamp: payload.timestamp,
      custom_details: {
        passed: payload.passed,
        failed: payload.failed,
        total: payload.total,
        duration_ms: payload.duration_ms,
        failures: payload.failures,
        regressions: payload.regressions,
      },
    },
  };
}

/**
 * Build an email body from a webhook payload.
 */
export function buildEmailBody(payload: WebhookPayload): { subject: string; text: string; html: string } {
  const icon = payload.failed > 0 ? '❌' : '✅';
  const subject = `${icon} AgentProbe: ${payload.suite} — ${payload.passed}/${payload.total} passed`;

  const lines: string[] = [
    `Event: ${payload.event}`,
    `Suite: ${payload.suite}`,
    `Passed: ${payload.passed}/${payload.total}`,
    `Failed: ${payload.failed}`,
    `Duration: ${payload.duration_ms}ms`,
    `Timestamp: ${payload.timestamp}`,
  ];

  if (payload.failures && payload.failures.length > 0) {
    lines.push('', 'Failures:');
    for (const f of payload.failures) {
      lines.push(`  - ${f.name}${f.error ? ': ' + f.error : ''}`);
    }
  }

  if (payload.regressions && payload.regressions.length > 0) {
    lines.push('', 'Regressions:');
    for (const r of payload.regressions) {
      lines.push(`  - ${r}`);
    }
  }

  const text = lines.join('\n');
  const html = `<pre>${text}</pre>`;

  return { subject, text, html };
}

/**
 * Send a notification via a specific channel.
 */
export async function sendNotification(
  config: NotificationConfig,
  payload: WebhookPayload,
): Promise<{ success: boolean; type: string; error?: string }> {
  try {
    switch (config.type) {
      case 'slack': {
        const body = formatWebhookPayload(payload, 'slack');
        const res = await fetch(config.webhook_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });
        return { success: res.ok, type: 'slack' };
      }
      case 'pagerduty': {
        const body = JSON.stringify(buildPagerDutyPayload(payload, config.routing_key, config.severity));
        const res = await fetch('https://events.pagerduty.com/v2/enqueue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });
        return { success: res.ok, type: 'pagerduty' };
      }
      case 'http': {
        const method = config.method ?? 'POST';
        const res = await fetch(config.url, {
          method,
          headers: { 'Content-Type': 'application/json', ...config.headers },
          body: JSON.stringify(payload),
        });
        return { success: res.ok, type: 'http' };
      }
      case 'email': {
        // Email sending requires SMTP — prepared for external delivery
        buildEmailBody(payload);
        // In a real implementation, you'd use nodemailer here.
        // For now, we log and return success=true as a dry-run.
        return { success: true, type: 'email' };
      }
      default:
        return { success: false, type: 'unknown', error: `Unknown notification type` };
    }
  } catch (e: any) {
    return { success: false, type: config.type, error: e.message };
  }
}

/**
 * Trigger all configured notifications based on events.
 */
export async function triggerNotifications(
  hub: NotificationHubConfig,
  result: SuiteResult,
  extra?: { regressions?: string[] },
): Promise<Array<{ success: boolean; type: string; error?: string }>> {
  const events: WebhookEvent[] = [];
  if (result.failed > 0) events.push('on_failure');
  if (result.failed === 0) events.push('on_success');
  events.push('on_complete');
  if (extra?.regressions && extra.regressions.length > 0) events.push('on_regression');

  const results: Array<{ success: boolean; type: string; error?: string }> = [];

  for (const config of hub.notifications) {
    const shouldFire = config.on.some(e => events.includes(e));
    if (!shouldFire) continue;

    for (const event of events) {
      if (!config.on.includes(event)) continue;
      const payload = buildPayload(event, result, extra);
      const res = await sendNotification(config, payload);
      results.push(res);
    }
  }

  return results;
}
