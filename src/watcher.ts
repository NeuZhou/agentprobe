/**
 * Watch Mode - Re-run tests on file changes.
 * Enhanced: watch trace directories, auto-run on new traces, bell on failure, running summary.
 */

import * as fs from 'fs';
import * as path from 'path';
import { runSuite } from './runner';
import { report } from './reporter';
import type { ReportFormat } from './types';

export interface WatchOptions {
  suitePath: string;
  format: ReportFormat;
  extraWatchPaths?: string[];
  updateSnapshots?: boolean;
  tags?: string[];
  traceDir?: string;
}

export interface WatchSummary {
  runs: number;
  totalPassed: number;
  totalFailed: number;
  lastRun: string | null;
  consecutiveFailures: number;
}

export function startWatch(opts: WatchOptions): void {
  const { suitePath, format } = opts;
  const suiteDir = path.dirname(path.resolve(suitePath));

  const summary: WatchSummary = {
    runs: 0,
    totalPassed: 0,
    totalFailed: 0,
    lastRun: null,
    consecutiveFailures: 0,
  };

  console.log(`\n👁️  Watching for changes...`);
  console.log(`   Suite: ${suitePath}`);
  if (opts.traceDir) {
    console.log(`   Trace dir: ${opts.traceDir}`);
  }
  console.log(`   Press Ctrl+C to stop.\n`);

  let debounce: NodeJS.Timeout | null = null;

  const runTests = async (trigger?: string) => {
    console.clear();
    if (trigger) {
      console.log(`\n📝 Triggered by: ${trigger}`);
    }
    console.log(`\n🔄 Re-running tests...\n`);
    try {
      const result = await runSuite(suitePath, {
        updateSnapshots: opts.updateSnapshots,
        tags: opts.tags,
      });
      console.log(report(result, format));

      // Update summary
      summary.runs++;
      summary.totalPassed += result.passed;
      summary.totalFailed += result.failed;
      summary.lastRun = new Date().toLocaleTimeString();

      if (result.failed > 0) {
        summary.consecutiveFailures++;
        // Console bell for failure notification
        process.stdout.write('\x07');
      } else {
        summary.consecutiveFailures = 0;
      }

      // Print running summary
      printSummary(summary);
    } catch (err: any) {
      console.error(`❌ Error: ${err.message}`);
      summary.runs++;
      summary.consecutiveFailures++;
      process.stdout.write('\x07');
    }
    console.log(`\n👁️  Watching for changes...`);
  };

  const onChange = (_eventType: string, filename: string | null) => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      runTests(filename ?? 'file change');
    }, 300);
  };

  // Watch the suite file itself
  fs.watch(suitePath, onChange);

  // Watch the suite directory for agent source changes
  try {
    fs.watch(suiteDir, { recursive: true }, (evt, filename) => {
      if (
        filename &&
        (filename.endsWith('.ts') ||
          filename.endsWith('.js') ||
          filename.endsWith('.yaml') ||
          filename.endsWith('.yml'))
      ) {
        onChange(evt, filename);
      }
    });
  } catch {
    // recursive watch not supported on all platforms
  }

  // Watch trace directory for new trace files
  if (opts.traceDir && fs.existsSync(opts.traceDir)) {
    try {
      fs.watch(opts.traceDir, { recursive: true }, (evt, filename) => {
        if (filename && filename.endsWith('.json')) {
          onChange(evt, `trace: ${filename}`);
        }
      });
    } catch {
      /* ignore */
    }
  }

  // Watch additional paths
  for (const p of opts.extraWatchPaths ?? []) {
    try {
      fs.watch(p, { recursive: true }, onChange);
    } catch {
      /* ignore */
    }
  }

  // Initial run
  runTests('initial');
}

/**
 * Print a running summary of watch mode results.
 */
function printSummary(summary: WatchSummary): void {
  const lines: string[] = [];
  lines.push('');
  lines.push(`  📊 Watch Summary (${summary.runs} runs)`);
  lines.push(`     Total: ${summary.totalPassed} passed, ${summary.totalFailed} failed`);
  if (summary.lastRun) {
    lines.push(`     Last run: ${summary.lastRun}`);
  }
  if (summary.consecutiveFailures > 0) {
    lines.push(`     ⚠️  ${summary.consecutiveFailures} consecutive failure(s)`);
  }
  console.log(lines.join('\n'));
}

/**
 * Watch a trace directory and auto-run tests when new traces appear.
 */
export function watchTraceDir(
  traceDir: string,
  suitePath: string,
  opts?: { format?: ReportFormat },
): void {
  startWatch({
    suitePath,
    format: opts?.format ?? 'console',
    traceDir,
  });
}
