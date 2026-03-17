/**
 * Tests for src/themes.ts - Report theme management
 */
import { describe, it, expect } from 'vitest';
import {
  getTheme,
  getThemeNames,
  listThemes,
  applyTheme,
  formatThemes,
} from '../src/themes';

describe('Themes', () => {
  describe('getTheme', () => {
    it('should return dark theme', () => {
      const theme = getTheme('dark');
      expect(theme).not.toBeNull();
      expect(theme!.name).toBe('dark');
      expect(theme!.displayName).toBe('Dark');
      expect(theme!.css).toContain(':root');
    });

    it('should return corporate theme', () => {
      const theme = getTheme('corporate');
      expect(theme).not.toBeNull();
      expect(theme!.name).toBe('corporate');
    });

    it('should return minimal theme', () => {
      const theme = getTheme('minimal');
      expect(theme).not.toBeNull();
      expect(theme!.name).toBe('minimal');
    });

    it('should return null for unknown theme', () => {
      expect(getTheme('nonexistent')).toBeNull();
      expect(getTheme('')).toBeNull();
    });
  });

  describe('getThemeNames', () => {
    it('should return all three theme names', () => {
      const names = getThemeNames();
      expect(names).toContain('dark');
      expect(names).toContain('corporate');
      expect(names).toContain('minimal');
      expect(names).toHaveLength(3);
    });
  });

  describe('listThemes', () => {
    it('should return theme metadata for all themes', () => {
      const themes = listThemes();
      expect(themes).toHaveLength(3);
      for (const t of themes) {
        expect(t.name).toBeDefined();
        expect(t.displayName).toBeDefined();
        expect(t.description).toBeDefined();
      }
    });

    it('should not include CSS in listing', () => {
      const themes = listThemes();
      for (const t of themes) {
        expect((t as any).css).toBeUndefined();
      }
    });
  });

  describe('applyTheme', () => {
    const sampleHtml = `<html><head><style>
:root{--bg:#000;--text:#fff}
body{background:var(--bg)}
</style></head><body></body></html>`;

    it('should replace :root CSS variables with theme values', () => {
      const result = applyTheme(sampleHtml, 'corporate');
      expect(result).toContain('--bg:#f8f9fa');
      expect(result).not.toContain('--bg:#000');
    });

    it('should inject extra theme styles before </style>', () => {
      const result = applyTheme(sampleHtml, 'corporate');
      // Corporate theme has extra styles like .card, h1, h2
      expect(result).toContain('box-shadow');
    });

    it('should return original HTML for unknown theme', () => {
      const result = applyTheme(sampleHtml, 'nonexistent');
      expect(result).toBe(sampleHtml);
    });

    it('should handle HTML without :root block', () => {
      const html = '<html><head><style>body{color:red}</style></head></html>';
      const result = applyTheme(html, 'minimal');
      // Should still inject extra styles
      expect(result).toBeDefined();
    });
  });

  describe('formatThemes', () => {
    it('should format themes as console output', () => {
      const output = formatThemes();
      expect(output).toContain('dark');
      expect(output).toContain('corporate');
      expect(output).toContain('minimal');
      expect(output).toContain('agentprobe');
    });

    it('should include usage instructions', () => {
      const output = formatThemes();
      expect(output).toContain('--theme');
    });
  });
});
