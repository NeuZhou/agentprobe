/**
 * Adapter Auto-Detection — Detect available LLM adapters from environment.
 *
 * Scans environment variables, config files, and known paths to determine
 * which LLM providers are available and recommends the best one.
 */

import * as fs from 'fs';
import * as path from 'path';

// ===== Types =====

export interface DetectedAdapter {
  name: string;
  provider: string;
  /** How it was detected */
  source: 'env' | 'config' | 'file';
  /** The env var or file path */
  detail: string;
  /** Whether the key/config appears valid (non-empty, right prefix) */
  valid: boolean;
  /** Recommended priority (lower = preferred) */
  priority: number;
}

export interface AutoDetectResult {
  detected: DetectedAdapter[];
  recommended?: DetectedAdapter;
  warnings: string[];
}

// ===== Known adapter patterns =====

interface AdapterPattern {
  name: string;
  provider: string;
  envVars: string[];
  /** Optional key prefix validation */
  keyPrefix?: string;
  priority: number;
}

const ADAPTER_PATTERNS: AdapterPattern[] = [
  { name: 'openai', provider: 'OpenAI', envVars: ['OPENAI_API_KEY'], keyPrefix: 'sk-', priority: 1 },
  { name: 'anthropic', provider: 'Anthropic Claude', envVars: ['ANTHROPIC_API_KEY'], keyPrefix: 'sk-ant-', priority: 2 },
  { name: 'azure-openai', provider: 'Azure OpenAI', envVars: ['AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_ENDPOINT'], priority: 3 },
  { name: 'google', provider: 'Google Gemini', envVars: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'], priority: 4 },
  { name: 'cohere', provider: 'Cohere', envVars: ['COHERE_API_KEY'], priority: 5 },
  { name: 'mistral', provider: 'Mistral AI', envVars: ['MISTRAL_API_KEY'], priority: 6 },
  { name: 'groq', provider: 'Groq', envVars: ['GROQ_API_KEY'], keyPrefix: 'gsk_', priority: 7 },
  { name: 'together', provider: 'Together AI', envVars: ['TOGETHER_API_KEY'], priority: 8 },
  { name: 'fireworks', provider: 'Fireworks AI', envVars: ['FIREWORKS_API_KEY'], priority: 9 },
  { name: 'deepseek', provider: 'DeepSeek', envVars: ['DEEPSEEK_API_KEY'], priority: 10 },
  { name: 'ollama', provider: 'Ollama (local)', envVars: ['OLLAMA_HOST'], priority: 11 },
];

// ===== Detection =====

/**
 * Check if an API key looks valid based on prefix and length.
 */
export function validateKey(key: string, prefix?: string): boolean {
  if (!key || key.trim().length === 0) return false;
  if (key === 'your-api-key-here' || key === 'sk-xxx') return false;
  if (prefix && !key.startsWith(prefix)) return false;
  return key.length >= 10;
}

/**
 * Detect adapters from environment variables.
 */
export function detectFromEnv(env: Record<string, string | undefined> = process.env): DetectedAdapter[] {
  const detected: DetectedAdapter[] = [];

  for (const pattern of ADAPTER_PATTERNS) {
    for (const envVar of pattern.envVars) {
      const value = env[envVar];
      if (value !== undefined && value.length > 0) {
        const valid = pattern.keyPrefix
          ? validateKey(value, pattern.keyPrefix)
          : validateKey(value);
        detected.push({
          name: pattern.name,
          provider: pattern.provider,
          source: 'env',
          detail: envVar,
          valid,
          priority: pattern.priority,
        });
        break; // Found this adapter, don't check remaining env vars
      }
    }
  }

  return detected;
}

/**
 * Detect adapters from config file (.agentprobe.yaml, .agentprobe.json).
 */
export function detectFromConfig(dir: string = process.cwd()): DetectedAdapter[] {
  const detected: DetectedAdapter[] = [];
  const configFiles = ['.agentprobe.yaml', '.agentprobe.yml', '.agentprobe.json', 'agentprobe.config.json'];

  for (const file of configFiles) {
    const filePath = path.join(dir, file);
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        // Check for adapter references in config
        for (const pattern of ADAPTER_PATTERNS) {
          if (content.includes(pattern.name) || content.includes(pattern.provider.toLowerCase())) {
            detected.push({
              name: pattern.name,
              provider: pattern.provider,
              source: 'config',
              detail: filePath,
              valid: true,
              priority: pattern.priority,
            });
          }
        }
      } catch {
        // ignore read errors
      }
    }
  }

  return detected;
}

/**
 * Check for local model servers (Ollama).
 */
export function detectLocalModels(): DetectedAdapter[] {
  const detected: DetectedAdapter[] = [];

  // Check common Ollama paths
  const ollamaPaths = [
    path.join(process.env.HOME ?? process.env.USERPROFILE ?? '', '.ollama'),
    '/usr/local/bin/ollama',
  ];

  for (const p of ollamaPaths) {
    if (fs.existsSync(p)) {
      detected.push({
        name: 'ollama',
        provider: 'Ollama (local)',
        source: 'file',
        detail: p,
        valid: true,
        priority: 11,
      });
      break;
    }
  }

  return detected;
}

/**
 * Auto-detect all available LLM adapters and recommend the best one.
 */
export function autoDetect(options?: {
  env?: Record<string, string | undefined>;
  dir?: string;
  checkLocal?: boolean;
}): AutoDetectResult {
  const env = options?.env ?? process.env;
  const dir = options?.dir ?? process.cwd();
  const checkLocal = options?.checkLocal ?? true;

  const detected: DetectedAdapter[] = [];
  const warnings: string[] = [];

  // Environment detection
  detected.push(...detectFromEnv(env));

  // Config file detection
  const configDetected = detectFromConfig(dir);
  // Deduplicate by name
  for (const cd of configDetected) {
    if (!detected.some(d => d.name === cd.name)) {
      detected.push(cd);
    }
  }

  // Local model detection
  if (checkLocal) {
    const localDetected = detectLocalModels();
    for (const ld of localDetected) {
      if (!detected.some(d => d.name === ld.name)) {
        detected.push(ld);
      }
    }
  }

  // Warnings
  const invalidKeys = detected.filter(d => !d.valid);
  for (const inv of invalidKeys) {
    warnings.push(`${inv.provider}: key found in ${inv.detail} but appears invalid`);
  }

  if (detected.length === 0) {
    warnings.push('No LLM adapters detected. Set an API key environment variable (e.g., OPENAI_API_KEY).');
  }

  // Recommend the highest-priority valid adapter
  const validAdapters = detected.filter(d => d.valid).sort((a, b) => a.priority - b.priority);
  const recommended = validAdapters[0];

  return { detected, recommended, warnings };
}

/**
 * Format auto-detection result for console display.
 */
export function formatAutoDetect(result: AutoDetectResult): string {
  const lines: string[] = [];
  lines.push('\n🔍 AgentProbe Adapter Auto-Detection');
  lines.push('='.repeat(40));

  if (result.detected.length === 0) {
    lines.push('❌ No adapters detected');
  } else {
    for (const d of result.detected) {
      const icon = d.valid ? '✅' : '⚠️';
      const rec = result.recommended?.name === d.name ? ' ⭐ RECOMMENDED' : '';
      lines.push(`${icon} ${d.provider} (${d.source}: ${d.detail})${rec}`);
    }
  }

  if (result.recommended) {
    lines.push(`\nRecommended: ${result.recommended.provider}`);
  }

  for (const w of result.warnings) {
    lines.push(`⚠️ ${w}`);
  }

  return lines.join('\n');
}
