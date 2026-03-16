/**
 * Baseline Management — Save, load, list, and promote test baselines
 * @module
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SuiteResult } from './types';
import type { Baseline } from './regression';
import { saveBaseline as _saveBaseline, loadBaseline as _loadBaseline } from './regression';

const DEFAULT_DIR = '.agentprobe/baselines';
void '.agentprobe/baselines/.promoted'; // PROMOTED_FILE - reserved for future use

export interface BaselineInfo {
  name: string;
  savedAt: string;
  suite: string;
  testCount: number;
  filePath: string;
  isPromoted: boolean;
}

export class BaselineManager {
  private dir: string;

  constructor(dir?: string) {
    this.dir = dir ?? DEFAULT_DIR;
  }

  save(name: string, result: SuiteResult): string {
    if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
    const baseline: Baseline = {
      saved_at: new Date().toISOString(),
      suite: name,
      tests: result.results.map(r => ({
        name: r.name,
        passed: r.passed,
        steps: r.trace?.steps.length ?? 0,
        duration_ms: r.duration_ms,
        cost_usd: 0,
        assertions_passed: r.assertions.filter(a => a.passed).length,
        assertions_total: r.assertions.length,
      })),
    };
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filePath = path.join(this.dir, `${safeName}.json`);
    fs.writeFileSync(filePath, JSON.stringify(baseline, null, 2));
    return filePath;
  }

  load(name: string): Baseline | null {
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filePath = path.join(this.dir, `${safeName}.json`);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }

  list(): BaselineInfo[] {
    if (!fs.existsSync(this.dir)) return [];
    const promoted = this.getPromotedName();
    return fs.readdirSync(this.dir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const filePath = path.join(this.dir, f);
        try {
          const data: Baseline = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          const name = f.replace(/\.json$/, '');
          return {
            name,
            savedAt: data.saved_at,
            suite: data.suite,
            testCount: data.tests.length,
            filePath,
            isPromoted: name === promoted,
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean) as BaselineInfo[];
  }

  promote(name: string): void {
    const baseline = this.load(name);
    if (!baseline) throw new Error(`Baseline "${name}" not found`);
    fs.writeFileSync(path.join(this.dir, '.promoted'), name);
  }

  getPromoted(): Baseline | null {
    const name = this.getPromotedName();
    return name ? this.load(name) : null;
  }

  getPromotedName(): string | null {
    const promotedPath = path.join(this.dir, '.promoted');
    if (!fs.existsSync(promotedPath)) return null;
    return fs.readFileSync(promotedPath, 'utf-8').trim();
  }

  delete(name: string): boolean {
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filePath = path.join(this.dir, `${safeName}.json`);
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    // Clear promoted if this was it
    if (this.getPromotedName() === safeName) {
      const p = path.join(this.dir, '.promoted');
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    return true;
  }
}

/**
 * Format a baseline listing for console display.
 */
export function formatBaselineList(baselines: BaselineInfo[]): string {
  if (baselines.length === 0) return 'No baselines saved.';
  return baselines.map(b =>
    `${b.isPromoted ? '★' : ' '} ${b.name} — ${b.testCount} tests — ${b.savedAt}`
  ).join('\n');
}
