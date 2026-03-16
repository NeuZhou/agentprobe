/**
 * Watch Mode - Re-run tests on file changes
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
}

export function startWatch(opts: WatchOptions): void {
  const { suitePath, format } = opts;
  const suiteDir = path.dirname(path.resolve(suitePath));

  console.log(`\n👁️  Watching for changes...`);
  console.log(`   Suite: ${suitePath}`);
  console.log(`   Press Ctrl+C to stop.\n`);

  let debounce: NodeJS.Timeout | null = null;

  const runTests = async () => {
    console.clear();
    console.log(`\n🔄 Re-running tests...\n`);
    try {
      const result = await runSuite(suitePath, {
        updateSnapshots: opts.updateSnapshots,
        tags: opts.tags,
      });
      console.log(report(result, format));
    } catch (err: any) {
      console.error(`❌ Error: ${err.message}`);
    }
    console.log(`\n👁️  Watching for changes...`);
  };

  const onChange = (eventType: string, filename: string | null) => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      if (filename) console.log(`\n📝 Changed: ${filename}`);
      runTests();
    }, 300);
  };

  // Watch the suite file itself
  fs.watch(suitePath, onChange);

  // Watch the suite directory for agent source changes
  try {
    fs.watch(suiteDir, { recursive: true }, (evt, filename) => {
      if (filename && (filename.endsWith('.ts') || filename.endsWith('.js') || filename.endsWith('.yaml') || filename.endsWith('.yml'))) {
        onChange(evt, filename);
      }
    });
  } catch {
    // recursive watch not supported on all platforms
  }

  // Watch additional paths
  for (const p of opts.extraWatchPaths ?? []) {
    try {
      fs.watch(p, { recursive: true }, onChange);
    } catch { /* ignore */ }
  }

  // Initial run
  runTests();
}
