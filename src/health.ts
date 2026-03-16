/**
 * Adapter Health Check - verify connectivity to LLM providers.
 *
 * Checks each configured adapter by sending a minimal probe request.
 */

import chalk from 'chalk';

export interface AdapterHealthResult {
  name: string;
  status: 'connected' | 'error' | 'unconfigured';
  models?: string[];
  error?: string;
  latency_ms?: number;
}

export interface HealthCheckResult {
  adapters: AdapterHealthResult[];
  timestamp: string;
}

interface AdapterProbe {
  name: string;
  envKeys: string[];
  probe: (env: Record<string, string | undefined>) => Promise<AdapterHealthResult>;
}

async function probeEndpoint(url: string, headers: Record<string, string>, timeout = 5000): Promise<{ ok: boolean; data?: any; error?: string; latency_ms: number }> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const res = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timer);
    const latency_ms = Date.now() - start;
    if (res.ok) {
      const data = await res.json().catch(() => null);
      return { ok: true, data, latency_ms };
    }
    return { ok: false, error: `HTTP ${res.status}`, latency_ms };
  } catch (err: any) {
    return { ok: false, error: err.message || String(err), latency_ms: Date.now() - start };
  }
}

const ADAPTER_PROBES: AdapterProbe[] = [
  {
    name: 'openai',
    envKeys: ['OPENAI_API_KEY'],
    probe: async (env) => {
      const key = env.OPENAI_API_KEY;
      if (!key) return { name: 'openai', status: 'unconfigured' };
      const result = await probeEndpoint('https://api.openai.com/v1/models', {
        Authorization: `Bearer ${key}`,
      });
      if (result.ok && result.data?.data) {
        const models = result.data.data.slice(0, 5).map((m: any) => m.id);
        return { name: 'openai', status: 'connected', models, latency_ms: result.latency_ms };
      }
      return { name: 'openai', status: 'error', error: result.error, latency_ms: result.latency_ms };
    },
  },
  {
    name: 'anthropic',
    envKeys: ['ANTHROPIC_API_KEY'],
    probe: async (env) => {
      const key = env.ANTHROPIC_API_KEY;
      if (!key) return { name: 'anthropic', status: 'unconfigured' };
      // Anthropic doesn't have a models endpoint; send a minimal messages request
      const result = await probeEndpoint('https://api.anthropic.com/v1/messages', {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      });
      // Even a 400 means the API is reachable
      if (result.ok || result.error?.includes('400') || result.error?.includes('422')) {
        return { name: 'anthropic', status: 'connected', models: ['claude-3-opus', 'claude-3-sonnet'], latency_ms: result.latency_ms };
      }
      return { name: 'anthropic', status: 'error', error: result.error, latency_ms: result.latency_ms };
    },
  },
  {
    name: 'azure',
    envKeys: ['AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_KEY'],
    probe: async (env) => {
      const endpoint = env.AZURE_OPENAI_ENDPOINT;
      const key = env.AZURE_OPENAI_KEY;
      if (!endpoint || !key) return { name: 'azure', status: 'unconfigured' };
      const url = `${endpoint.replace(/\/$/, '')}/openai/deployments?api-version=2024-02-01`;
      const result = await probeEndpoint(url, { 'api-key': key });
      if (result.ok && result.data?.data) {
        const models = result.data.data.map((d: any) => d.id || d.model);
        return { name: 'azure', status: 'connected', models, latency_ms: result.latency_ms };
      }
      return { name: 'azure', status: 'error', error: result.error, latency_ms: result.latency_ms };
    },
  },
  {
    name: 'local',
    envKeys: [],
    probe: async (env) => {
      const url = env.LOCAL_LLM_URL || 'http://localhost:11434';
      const result = await probeEndpoint(`${url}/api/tags`, {});
      if (result.ok && result.data?.models) {
        const models = result.data.models.map((m: any) => m.name);
        return { name: 'local', status: 'connected', models, latency_ms: result.latency_ms };
      }
      return { name: 'local', status: 'error', error: result.error || 'connection refused', latency_ms: result.latency_ms };
    },
  },
];

/**
 * Run health checks against all known adapters.
 */
export async function checkHealth(env?: Record<string, string | undefined>): Promise<HealthCheckResult> {
  const effectiveEnv = env || (process.env as Record<string, string | undefined>);
  const adapters: AdapterHealthResult[] = [];
  for (const probe of ADAPTER_PROBES) {
    try {
      const result = await probe.probe(effectiveEnv);
      adapters.push(result);
    } catch (err: any) {
      adapters.push({ name: probe.name, status: 'error', error: err.message });
    }
  }
  return { adapters, timestamp: new Date().toISOString() };
}

/**
 * Format health check results for console output.
 */
export function formatHealth(result: HealthCheckResult): string {
  const lines = ['Adapter Status:'];
  for (const a of result.adapters) {
    if (a.status === 'connected') {
      const models = a.models?.length ? ` (${a.models.join(', ')})` : '';
      const latency = a.latency_ms ? ` [${a.latency_ms}ms]` : '';
      lines.push(chalk.green(`  ✓ ${a.name}: connected${models}${latency}`));
    } else if (a.status === 'unconfigured') {
      lines.push(chalk.gray(`  ○ ${a.name}: not configured`));
    } else {
      const err = a.error ? ` (${a.error})` : '';
      lines.push(chalk.red(`  ✗ ${a.name}: ${a.error || 'error'}${err ? '' : ''}`));
    }
  }
  return lines.join('\n');
}
