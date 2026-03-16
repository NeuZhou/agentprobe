/**
 * Watch Mode - Enhanced file watcher with smart change detection.
 * Watches test files, source files, and trace directories.
 * Re-runs only affected tests when possible.
 */

import * as fs from 'fs';
import * as path from 'path';
import { runSuite } from './runner';
import { report } from './reporter';
import type { ReportFormat, SuiteResult } from './types';

export interface SmartWatchOptions {
  paths: string[];
  format?: ReportFormat;
  updateSnapshots?: boolean;
  tags?: string[];
  debounceMs?: number;
  onResult?: (result: SuiteResult) => void;
}

export interface WatchEvent {
  type: 'change' | 'add' | 'remove';
  path: string;
  timestamp: string;
}

export interface WatchSession {
  events: WatchEvent[];
  runs: number;
  passed: number;
  failed: number;
  startedAt: string;
}

/**
 * Determine which suite files are affected by a changed file.
 */
export function findAffectedSuites(changedFile: string, suitePaths: string[]): string[] {
  const ext = path.extname(changedFile);

  // If a suite file itself changed, return just that suite
  if (ext === '.yaml' || ext === '.yml') {
    const match = suitePaths.find(
      (s) => path.resolve(s) === path.resolve(changedFile),
    );
    if (match) return [match];
  }

  // Source file changed → re-run all suites
  if (ext === '.ts' || ext === '.js') {
    return [...suitePaths];
  }

  return [];
}

/**
 * Format a watch event for display.
 */
export function formatWatchEvent(event: WatchEvent): string {
  const time = new Date(event.timestamp).toLocaleTimeString();
  const icon = event.type === 'change' ? '📝' : event.type === 'add' ? '➕' : '➖';
  return `[${time}] ${icon} ${event.type}: ${event.path}`;
}

/**
 * Format the watch session summary.
 */
export function formatWatchSession(session: WatchSession): string {
  const lines: string[] = [];
  lines.push(`\n📊 Watch Session Summary`);
  lines.push(`   Started: ${session.startedAt}`);
  lines.push(`   Runs: ${session.runs}`);
  lines.push(`   Total: ${session.passed} passed, ${session.failed} failed`);
  lines.push(`   Events: ${session.events.length} file changes detected`);
  return lines.join('\n');
}

/**
 * Start smart watch mode.
 * Returns a cleanup function to stop watching.
 */
export function startSmartWatch(opts: SmartWatchOptions): { stop: () => void; session: WatchSession } {
  const watchers: fs.FSWatcher[] = [];
  const session: WatchSession = {
    events: [],
    runs: 0,
    passed: 0,
    failed: 0,
    startedAt: new Date().toISOString(),
  };

  const debounceMs = opts.debounceMs ?? 300;
  let debounce: NodeJS.Timeout | null = null;

  const suitePaths = opts.paths.filter(
    (p) => p.endsWith('.yaml') || p.endsWith('.yml'),
  );

  const runAffected = async (changedFile: string) => {
    const affected = findAffectedSuites(changedFile, suitePaths);
    if (affected.length === 0 && suitePaths.length > 0) {
      // Default: run first suite
      affected.push(suitePaths[0]);
    }

    for (const suite of affected) {
      try {
        const result = await runSuite(suite, {
          updateSnapshots: opts.updateSnapshots,
          tags: opts.tags,
        });
        session.runs++;
        session.passed += result.passed;
        session.failed += result.failed;

        if (opts.onResult) opts.onResult(result);

        console.log(report(result, opts.format ?? 'console'));

        if (result.failed > 0) {
          process.stdout.write('\x07'); // bell
        }
      } catch (err: any) {
        console.error(`❌ Error running ${suite}: ${err.message}`);
        session.runs++;
      }
    }
  };

  const onChange = (filePath: string) => {
    const event: WatchEvent = {
      type: 'change',
      path: filePath,
      timestamp: new Date().toISOString(),
    };
    session.events.push(event);
    console.log(formatWatchEvent(event));

    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => runAffected(filePath), debounceMs);
  };

  // Watch each path
  for (const p of opts.paths) {
    try {
      const resolved = path.resolve(p);
      const stat = fs.statSync(resolved);

      if (stat.isDirectory()) {
        const w = fs.watch(resolved, { recursive: true }, (_evt, filename) => {
          if (filename) onChange(path.join(resolved, filename));
        });
        watchers.push(w);
      } else {
        const w = fs.watch(resolved, () => onChange(resolved));
        watchers.push(w);
      }
    } catch {
      // path doesn't exist yet, skip
    }
  }

  console.log(`\n👁️  Smart watch started (${opts.paths.length} paths)`);
  console.log(`   Press Ctrl+C to stop.\n`);

  return {
    stop: () => {
      for (const w of watchers) w.close();
      if (debounce) clearTimeout(debounce);
    },
    session,
  };
}
