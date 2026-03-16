/**
 * Error Catalog — Structured error codes with helpful messages.
 *
 * @example
 * ```
 * AP001: Adapter connection failed
 *   → Check your API key in .env or OPENAI_API_KEY
 * AP002: Trace format invalid
 *   → Ensure trace has 'steps' array with 'type' and 'content'
 * AP003: Budget exceeded
 *   → Current spend: $5.23, limit: $5.00
 * ```
 */

// ===== Error Code Registry =====

export interface ErrorInfo {
  code: string;
  title: string;
  hint: string;
  category: ErrorCategory;
}

export type ErrorCategory = 'adapter' | 'trace' | 'budget' | 'config' | 'test' | 'io' | 'internal';

const ERROR_CATALOG: Record<string, ErrorInfo> = {
  AP001: {
    code: 'AP001',
    title: 'Adapter connection failed',
    hint: 'Check your API key in .env or OPENAI_API_KEY',
    category: 'adapter',
  },
  AP002: {
    code: 'AP002',
    title: 'Trace format invalid',
    hint: "Ensure trace has 'steps' array with 'type' and 'content'",
    category: 'trace',
  },
  AP003: {
    code: 'AP003',
    title: 'Budget exceeded',
    hint: 'Current spend exceeds the configured limit. Increase budget or reduce test scope.',
    category: 'budget',
  },
  AP004: {
    code: 'AP004',
    title: 'Suite file not found',
    hint: 'Check the path to your test suite YAML file.',
    category: 'io',
  },
  AP005: {
    code: 'AP005',
    title: 'Invalid YAML syntax',
    hint: 'Check your test suite for YAML syntax errors. Use a linter.',
    category: 'config',
  },
  AP006: {
    code: 'AP006',
    title: 'Test timeout exceeded',
    hint: 'Increase timeout_ms in test config or reduce the complexity of the test.',
    category: 'test',
  },
  AP007: {
    code: 'AP007',
    title: 'Snapshot mismatch',
    hint: 'Run `agentprobe update-snapshots` to update, or check for behavioral regression.',
    category: 'test',
  },
  AP008: {
    code: 'AP008',
    title: 'Adapter not supported',
    hint: 'Supported adapters: openai, anthropic, gemini, azure-openai, ollama.',
    category: 'adapter',
  },
  AP009: {
    code: 'AP009',
    title: 'Mock configuration invalid',
    hint: 'Ensure mocks are keyed by tool name with valid return values.',
    category: 'config',
  },
  AP010: {
    code: 'AP010',
    title: 'Circular dependency detected',
    hint: 'Check depends_on fields in your test suite for circular references.',
    category: 'test',
  },
  AP011: {
    code: 'AP011',
    title: 'Plugin load failed',
    hint: 'Verify the plugin module path and that it exports a valid plugin interface.',
    category: 'config',
  },
  AP012: {
    code: 'AP012',
    title: 'Trace file corrupted',
    hint: 'Re-record the trace. Ensure the file is valid JSON.',
    category: 'trace',
  },
  AP013: {
    code: 'AP013',
    title: 'Assertion syntax error',
    hint: 'Check your expect block for valid assertion keys. See docs for supported assertions.',
    category: 'test',
  },
  AP014: {
    code: 'AP014',
    title: 'Fixture not found',
    hint: 'Ensure the fixture file exists and the path is relative to the suite file.',
    category: 'io',
  },
  AP015: {
    code: 'AP015',
    title: 'Compression failed',
    hint: 'Check disk space and file permissions. Ensure traces are valid JSON.',
    category: 'io',
  },
};

// ===== AgentProbeError Class =====

export class AgentProbeError extends Error {
  public readonly code: string;
  public readonly hint: string;
  public readonly category: ErrorCategory;
  public readonly context?: Record<string, any>;

  constructor(code: string, context?: Record<string, any>) {
    const info = ERROR_CATALOG[code];
    if (!info) {
      super(`Unknown error code: ${code}`);
      this.code = code;
      this.hint = 'This is an unknown error. Please report it.';
      this.category = 'internal';
      this.context = context;
      return;
    }

    let hint = info.hint;
    // Interpolate context into hint
    if (context) {
      if (code === 'AP003' && context.spend !== undefined && context.limit !== undefined) {
        hint = `Current spend: $${context.spend.toFixed(2)}, limit: $${context.limit.toFixed(2)}`;
      }
    }

    super(`${info.code}: ${info.title}`);
    this.name = 'AgentProbeError';
    this.code = info.code;
    this.hint = hint;
    this.category = info.category;
    this.context = context;
  }

  /**
   * Format for CLI display.
   */
  format(): string {
    return `${this.code}: ${this.message.replace(`${this.code}: `, '')}\n  → ${this.hint}`;
  }
}

// ===== Utility Functions =====

/**
 * Get error info by code.
 */
export function getError(code: string): ErrorInfo | undefined {
  return ERROR_CATALOG[code];
}

/**
 * Get all error codes.
 */
export function getAllErrors(): ErrorInfo[] {
  return Object.values(ERROR_CATALOG);
}

/**
 * Get errors by category.
 */
export function getErrorsByCategory(category: ErrorCategory): ErrorInfo[] {
  return Object.values(ERROR_CATALOG).filter((e) => e.category === category);
}

/**
 * Format an error catalog entry for display.
 */
export function formatError(info: ErrorInfo): string {
  return `${info.code}: ${info.title}\n  → ${info.hint}`;
}

/**
 * Format all errors for CLI help display.
 */
export function formatErrorCatalog(): string {
  const lines: string[] = ['AgentProbe Error Catalog', '═'.repeat(40)];
  const categories = ['adapter', 'trace', 'budget', 'config', 'test', 'io', 'internal'] as const;
  for (const cat of categories) {
    const errors = getErrorsByCategory(cat);
    if (errors.length === 0) continue;
    lines.push(`\n[${cat.toUpperCase()}]`);
    for (const e of errors) {
      lines.push(`  ${e.code}: ${e.title}`);
      lines.push(`    → ${e.hint}`);
    }
  }
  return lines.join('\n');
}
