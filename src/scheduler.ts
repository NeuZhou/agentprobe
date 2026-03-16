/**
 * Test Scheduler — Schedule recurring test runs with cron expressions
 *
 * @example
 * ```yaml
 * schedule:
 *   - name: "nightly regression"
 *     cron: "0 2 * * *"
 *     suite: tests/regression.yaml
 *     notify: [slack, email]
 * ```
 */

export interface ScheduleEntry {
  name: string;
  cron: string;
  suite: string;
  notify?: string[];
  enabled?: boolean;
  timeout_ms?: number;
  env?: Record<string, string>;
  tags?: string[];
}

export interface ScheduleConfig {
  schedule: ScheduleEntry[];
  defaults?: {
    timeout_ms?: number;
    notify?: string[];
    env?: Record<string, string>;
  };
}

export interface ScheduleRun {
  name: string;
  suite: string;
  scheduledAt: string;
  startedAt?: string;
  completedAt?: string;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'timeout';
  result?: { passed: number; failed: number; total: number };
  error?: string;
  notify?: string[];
}

/**
 * Parse a cron field (supports *, N, and * /N).
 */
export function parseCronField(field: string, min: number, max: number): number[] {
  if (field === '*') {
    return Array.from({ length: max - min + 1 }, (_, i) => i + min);
  }
  if (field.includes('/')) {
    const [, stepStr] = field.split('/');
    const step = parseInt(stepStr, 10);
    if (isNaN(step) || step <= 0) return [];
    const result: number[] = [];
    for (let i = min; i <= max; i += step) {
      result.push(i);
    }
    return result;
  }
  if (field.includes(',')) {
    return field.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n >= min && n <= max);
  }
  if (field.includes('-')) {
    const [startStr, endStr] = field.split('-');
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);
    if (isNaN(start) || isNaN(end)) return [];
    const result: number[] = [];
    for (let i = start; i <= end && i <= max; i++) {
      result.push(i);
    }
    return result;
  }
  const n = parseInt(field, 10);
  if (isNaN(n) || n < min || n > max) return [];
  return [n];
}

/**
 * Parse a 5-field cron expression.
 * Returns { minutes, hours, daysOfMonth, months, daysOfWeek }.
 */
export function parseCron(expr: string): {
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
} | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  return {
    minutes: parseCronField(parts[0], 0, 59),
    hours: parseCronField(parts[1], 0, 23),
    daysOfMonth: parseCronField(parts[2], 1, 31),
    months: parseCronField(parts[3], 1, 12),
    daysOfWeek: parseCronField(parts[4], 0, 6),
  };
}

/**
 * Check if a date matches a cron expression.
 */
export function matchesCron(expr: string, date: Date): boolean {
  const parsed = parseCron(expr);
  if (!parsed) return false;

  return (
    parsed.minutes.includes(date.getMinutes()) &&
    parsed.hours.includes(date.getHours()) &&
    parsed.daysOfMonth.includes(date.getDate()) &&
    parsed.months.includes(date.getMonth() + 1) &&
    parsed.daysOfWeek.includes(date.getDay())
  );
}

/**
 * Get the next matching time for a cron expression after a given date.
 * Returns null if no match found within maxIterations minutes.
 */
export function nextCronMatch(expr: string, after: Date, maxIterations = 525960): Date | null {
  const check = new Date(after);
  check.setSeconds(0, 0);
  check.setMinutes(check.getMinutes() + 1);

  for (let i = 0; i < maxIterations; i++) {
    if (matchesCron(expr, check)) return check;
    check.setMinutes(check.getMinutes() + 1);
  }
  return null;
}

/**
 * Validate a schedule configuration.
 */
export function validateSchedule(config: ScheduleConfig): string[] {
  const errors: string[] = [];

  if (!config.schedule || !Array.isArray(config.schedule)) {
    errors.push('schedule must be an array');
    return errors;
  }

  const names = new Set<string>();
  for (let i = 0; i < config.schedule.length; i++) {
    const entry = config.schedule[i];
    if (!entry.name) errors.push(`schedule[${i}]: missing name`);
    if (!entry.cron) errors.push(`schedule[${i}]: missing cron`);
    if (!entry.suite) errors.push(`schedule[${i}]: missing suite`);
    if (entry.cron && !parseCron(entry.cron)) {
      errors.push(`schedule[${i}]: invalid cron expression "${entry.cron}"`);
    }
    if (entry.name && names.has(entry.name)) {
      errors.push(`schedule[${i}]: duplicate name "${entry.name}"`);
    }
    if (entry.name) names.add(entry.name);
  }

  return errors;
}

/**
 * Get all schedule entries that should run at a given time.
 */
export function getDueEntries(config: ScheduleConfig, now: Date): ScheduleEntry[] {
  return config.schedule.filter(entry => {
    if (entry.enabled === false) return false;
    return matchesCron(entry.cron, now);
  });
}

/**
 * Merge entry with defaults.
 */
export function resolveEntry(entry: ScheduleEntry, defaults?: ScheduleConfig['defaults']): ScheduleEntry {
  if (!defaults) return entry;
  return {
    ...entry,
    timeout_ms: entry.timeout_ms ?? defaults.timeout_ms,
    notify: entry.notify ?? defaults.notify,
    env: { ...defaults.env, ...entry.env },
  };
}

/**
 * Create a schedule run record.
 */
export function createRun(entry: ScheduleEntry): ScheduleRun {
  return {
    name: entry.name,
    suite: entry.suite,
    scheduledAt: new Date().toISOString(),
    status: 'pending',
    notify: entry.notify,
  };
}

/**
 * Format schedule overview for display.
 */
export function formatSchedule(config: ScheduleConfig): string {
  const lines = ['📅 Test Schedule:', ''];
  for (const entry of config.schedule) {
    const status = entry.enabled === false ? '⏸️  DISABLED' : '✅ ENABLED';
    const next = nextCronMatch(entry.cron, new Date());
    const nextStr = next ? next.toISOString() : 'N/A';
    lines.push(`  ${entry.name}`);
    lines.push(`    Cron: ${entry.cron}`);
    lines.push(`    Suite: ${entry.suite}`);
    lines.push(`    Status: ${status}`);
    lines.push(`    Next: ${nextStr}`);
    if (entry.notify) lines.push(`    Notify: ${entry.notify.join(', ')}`);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Format a schedule run for display.
 */
export function formatRun(run: ScheduleRun): string {
  const status = {
    pending: '⏳',
    running: '🔄',
    passed: '✅',
    failed: '❌',
    skipped: '⏭️',
    timeout: '⏱️',
  }[run.status];

  let line = `${status} ${run.name} — ${run.suite} [${run.status}]`;
  if (run.result) {
    line += ` (${run.result.passed}/${run.result.total} passed)`;
  }
  if (run.error) {
    line += ` Error: ${run.error}`;
  }
  return line;
}
