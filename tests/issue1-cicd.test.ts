/**
 * Issue #1: CI/CD automated npm publish
 * Tests that CI/CD workflows are properly configured.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yaml';

const ROOT = path.resolve(__dirname, '..');

describe('CI/CD Automated Publish (Issue #1)', () => {
  describe('release.yml workflow', () => {
    const releasePath = path.join(ROOT, '.github/workflows/release.yml');

    it('should exist', () => {
      expect(fs.existsSync(releasePath)).toBe(true);
    });

    it('should trigger on version tags', () => {
      const content = YAML.parse(fs.readFileSync(releasePath, 'utf-8'));
      expect(content.on?.push?.tags).toBeDefined();
      const tags = content.on.push.tags;
      expect(tags.some((t: string) => t.includes('v*'))).toBe(true);
    });

    it('should use npm publish with provenance', () => {
      const raw = fs.readFileSync(releasePath, 'utf-8');
      expect(raw).toContain('npm publish');
      expect(raw).toContain('--provenance');
    });

    it('should have id-token write permission for provenance', () => {
      const content = YAML.parse(fs.readFileSync(releasePath, 'utf-8'));
      const publishJob = content.jobs?.publish;
      expect(publishJob?.permissions?.['id-token']).toBe('write');
    });

    it('should run tests before publishing', () => {
      const raw = fs.readFileSync(releasePath, 'utf-8');
      const publishIdx = raw.indexOf('npm publish');
      const testIdx = raw.indexOf('npm test');
      expect(testIdx).toBeLessThan(publishIdx);
      expect(testIdx).toBeGreaterThan(-1);
    });

    it('should create GitHub release', () => {
      const raw = fs.readFileSync(releasePath, 'utf-8');
      expect(raw).toContain('action-gh-release');
    });

    it('should use NPM_TOKEN secret', () => {
      const raw = fs.readFileSync(releasePath, 'utf-8');
      expect(raw).toContain('NPM_TOKEN');
    });
  });

  describe('ci.yml workflow', () => {
    const ciPath = path.join(ROOT, '.github/workflows/ci.yml');

    it('should exist', () => {
      expect(fs.existsSync(ciPath)).toBe(true);
    });

    it('should test on multiple OSes', () => {
      const content = YAML.parse(fs.readFileSync(ciPath, 'utf-8'));
      const matrix = content.jobs?.test?.strategy?.matrix;
      expect(matrix?.os).toBeDefined();
      expect(matrix.os.length).toBeGreaterThanOrEqual(2);
    });

    it('should test on multiple Node versions', () => {
      const content = YAML.parse(fs.readFileSync(ciPath, 'utf-8'));
      const matrix = content.jobs?.test?.strategy?.matrix;
      expect(matrix?.['node-version']).toBeDefined();
      expect(matrix['node-version'].length).toBeGreaterThanOrEqual(2);
    });

    it('should run lint, build, and test', () => {
      const raw = fs.readFileSync(ciPath, 'utf-8');
      expect(raw).toContain('npm run lint');
      expect(raw).toContain('npm run build');
      expect(raw).toContain('npm test');
    });
  });

  describe('package.json publish config', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));

    it('should have prepublishOnly script', () => {
      expect(pkg.scripts?.prepublishOnly).toBeDefined();
      expect(pkg.scripts.prepublishOnly).toContain('tsc');
    });

    it('should have files whitelist', () => {
      expect(pkg.files).toBeDefined();
      expect(pkg.files).toContain('dist/');
    });

    it('should exclude source maps from package', () => {
      expect(pkg.files.some((f: string) => f.includes('*.map'))).toBe(true);
    });

    it('should have repository URL', () => {
      expect(pkg.repository?.url).toBeDefined();
    });
  });
});
