/**
 * Test Impact Analysis — Smart test ordering based on risk signals.
 *
 * Analyzes test files to determine priority based on:
 * - File content patterns (security, safety keywords)
 * - Recent failure history
 * - Stability over time
 * - File modification recency
 */

import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yaml';
import type { TestSuite } from './types';

export type RiskLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface TestRiskAssessment {
  file: string;
  name: string;
  risk: RiskLevel;
  score: number;
  reasons: string[];
}

export interface ImpactAnalysisResult {
  assessments: TestRiskAssessment[];
  totalFiles: number;
  highRisk: number;
  mediumRisk: number;
  lowRisk: number;
}

export interface ImpactAnalysisOptions {
  /** History file for failure tracking */
  historyFile?: string;
  /** Days to consider "stable" if no failures */
  stableDays?: number;
  /** Changed files to check for impact */
  changedFiles?: string[];
}

const HIGH_RISK_PATTERNS = [
  /security/i,
  /safety/i,
  /auth/i,
  /credential/i,
  /injection/i,
  /privilege/i,
  /token/i,
  /secret/i,
  /encrypt/i,
  /permission/i,
];

const MEDIUM_RISK_PATTERNS = [
  /regression/i,
  /critical/i,
  /payment/i,
  /billing/i,
  /data.*loss/i,
  /failover/i,
  /recovery/i,
];

/**
 * Analyze risk of a single test file.
 */
export function analyzeTestFile(filePath: string): TestRiskAssessment {
  const content = fs.readFileSync(filePath, 'utf-8');
  const fileName = path.basename(filePath);
  let score = 50;
  const reasons: string[] = [];

  // Check for high-risk patterns
  for (const pat of HIGH_RISK_PATTERNS) {
    if (pat.test(content) || pat.test(fileName)) {
      score += 30;
      reasons.push(`matches safety-critical pattern: ${pat.source}`);
      break;
    }
  }

  // Check for medium-risk patterns
  for (const pat of MEDIUM_RISK_PATTERNS) {
    if (pat.test(content) || pat.test(fileName)) {
      score += 15;
      reasons.push(`matches important pattern: ${pat.source}`);
      break;
    }
  }

  // Check file modification time (recently modified = higher priority)
  try {
    const stat = fs.statSync(filePath);
    const daysSinceModified = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24);
    if (daysSinceModified < 1) {
      score += 20;
      reasons.push('modified today');
    } else if (daysSinceModified < 7) {
      score += 10;
      reasons.push('modified this week');
    }
  } catch {
    // ignore stat errors
  }

  // Larger test files tend to cover more critical paths
  const lineCount = content.split('\n').length;
  if (lineCount > 100) {
    score += 5;
    reasons.push(`large test file (${lineCount} lines)`);
  }

  // Parse YAML test count if applicable
  if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
    try {
      const suite = YAML.parse(content) as TestSuite;
      if (suite?.tests?.length > 10) {
        score += 5;
        reasons.push(`${suite.tests.length} test cases`);
      }
    } catch {
      // not a valid test suite
    }
  }

  if (reasons.length === 0) {
    reasons.push('standard test');
  }

  let risk: RiskLevel;
  if (score >= 80) risk = 'HIGH';
  else if (score >= 60) risk = 'MEDIUM';
  else risk = 'LOW';

  return {
    file: filePath,
    name: fileName,
    risk,
    score,
    reasons,
  };
}

/**
 * Analyze all test files in a directory.
 */
export function analyzeTestDirectory(
  dir: string,
  options: ImpactAnalysisOptions = {},
): ImpactAnalysisResult {
  const files = fs.readdirSync(dir).filter(
    f =>
      (f.endsWith('.yaml') || f.endsWith('.yml') || f.endsWith('.test.ts') || f.endsWith('.test.js')) &&
      !f.startsWith('.'),
  );

  const assessments = files
    .map(f => analyzeTestFile(path.join(dir, f)))
    .sort((a, b) => b.score - a.score);

  // Apply changed-files boost
  if (options.changedFiles?.length) {
    for (const assessment of assessments) {
      const baseName = path.basename(assessment.file).replace(/\.(test\.)?(ts|js|yaml|yml)$/, '');
      for (const changed of options.changedFiles) {
        const changedBase = path.basename(changed).replace(/\.\w+$/, '');
        if (baseName.includes(changedBase) || changedBase.includes(baseName)) {
          assessment.score += 25;
          assessment.reasons.push(`affected by changed file: ${changed}`);
          if (assessment.risk !== 'HIGH') assessment.risk = 'MEDIUM';
          break;
        }
      }
    }
    assessments.sort((a, b) => b.score - a.score);
  }

  return {
    assessments,
    totalFiles: assessments.length,
    highRisk: assessments.filter(a => a.risk === 'HIGH').length,
    mediumRisk: assessments.filter(a => a.risk === 'MEDIUM').length,
    lowRisk: assessments.filter(a => a.risk === 'LOW').length,
  };
}

/**
 * Format impact analysis results for display.
 */
export function formatImpactAnalysis(result: ImpactAnalysisResult): string {
  const lines: string[] = [];
  lines.push(`\n🎯 Test Priority Order (${result.totalFiles} files):\n`);
  lines.push(
    `  Risk: ${result.highRisk} HIGH · ${result.mediumRisk} MEDIUM · ${result.lowRisk} LOW\n`,
  );

  for (let i = 0; i < result.assessments.length; i++) {
    const a = result.assessments[i];
    const icon = a.risk === 'HIGH' ? '🔴' : a.risk === 'MEDIUM' ? '🟡' : '🟢';
    lines.push(`  ${(i + 1).toString().padStart(2)}. ${icon} ${a.name} (${a.risk} — ${a.reasons[0]})`);
  }

  return lines.join('\n');
}
