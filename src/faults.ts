/**
 * Fault Injection — Chaos engineering for AI agents.
 * Wraps tool calls with configurable failure modes to test agent resilience.
 */

export type FaultType = 'error' | 'timeout' | 'slow' | 'corrupt';

export interface FaultConfig {
  type: FaultType;
  message?: string;
  delay_ms?: number;
  probability?: number; // 0.0-1.0, default 1.0
}

export type FaultMap = Record<string, FaultConfig>;

/**
 * FaultInjector wraps tool execution with configurable failure injection.
 */
export class FaultInjector {
  private faults: FaultMap;

  constructor(faults: FaultMap = {}) {
    this.faults = faults;
  }

  /**
   * Check if a fault should be injected for a given tool.
   */
  shouldInject(toolName: string): boolean {
    const fault = this.faults[toolName];
    if (!fault) return false;
    const probability = fault.probability ?? 1.0;
    return Math.random() < probability;
  }

  /**
   * Get the fault config for a tool, or undefined if none.
   */
  getFault(toolName: string): FaultConfig | undefined {
    return this.faults[toolName];
  }

  /**
   * Wrap a tool call. Returns the result or throws/delays based on fault config.
   */
  async wrapToolCall<T>(toolName: string, execute: () => Promise<T>): Promise<T> {
    const fault = this.faults[toolName];

    if (!fault || !this.shouldInject(toolName)) {
      return execute();
    }

    switch (fault.type) {
      case 'error':
        throw new FaultInjectionError(
          fault.message || `Injected error for tool "${toolName}"`,
          toolName,
          fault
        );

      case 'timeout': {
        const delay = fault.delay_ms ?? 30000;
        await sleep(delay);
        throw new FaultInjectionError(
          fault.message || `Timeout after ${delay}ms for tool "${toolName}"`,
          toolName,
          fault
        );
      }

      case 'slow': {
        const delay = fault.delay_ms ?? 5000;
        await sleep(delay);
        return execute();
      }

      case 'corrupt': {
        const result = await execute();
        return corruptResult(result) as T;
      }

      default:
        return execute();
    }
  }

  /**
   * Get a summary of configured faults for reporting.
   */
  summary(): string[] {
    return Object.entries(this.faults).map(([tool, cfg]) => {
      const prob = cfg.probability != null ? ` (${(cfg.probability * 100).toFixed(0)}%)` : '';
      const detail = cfg.type === 'error' ? `: "${cfg.message || 'generic error'}"` :
                     cfg.type === 'timeout' ? `: ${cfg.delay_ms ?? 30000}ms` :
                     cfg.type === 'slow' ? `: +${cfg.delay_ms ?? 5000}ms` : '';
      return `${tool} → ${cfg.type}${detail}${prob}`;
    });
  }
}

export class FaultInjectionError extends Error {
  toolName: string;
  fault: FaultConfig;

  constructor(message: string, toolName: string, fault: FaultConfig) {
    super(message);
    this.name = 'FaultInjectionError';
    this.toolName = toolName;
    this.fault = fault;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function corruptResult(result: any): any {
  if (typeof result === 'string') {
    // Garble the string: truncate + add noise
    const truncated = result.slice(0, Math.floor(result.length * 0.4));
    return truncated + '\\x00\\xff\\xfe' + '... [corrupted]';
  }
  if (typeof result === 'object' && result !== null) {
    const str = JSON.stringify(result);
    const half = str.slice(0, Math.floor(str.length * 0.5));
    try {
      return JSON.parse(half + '"}');
    } catch {
      return { _corrupted: true, partial: half };
    }
  }
  return null; // numbers, booleans → null
}
