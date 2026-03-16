import { describe, it, expect } from 'vitest';
import { generateBadge } from '../src/badge';

describe('badge', () => {
  it('generates valid SVG for all passing', () => {
    const svg = generateBadge(10, 10);
    expect(svg).toContain('<svg');
    expect(svg).toContain('10/10 passing');
    expect(svg).toContain('#4c1'); // green
  });

  it('generates yellow badge for mostly passing', () => {
    const svg = generateBadge(29, 30);
    expect(svg).toContain('29/30 passing');
    expect(svg).toContain('#dfb317'); // yellow
  });

  it('generates red badge for many failures', () => {
    const svg = generateBadge(5, 30);
    expect(svg).toContain('5/30 passing');
    expect(svg).toContain('#e05d44'); // red
  });
});
