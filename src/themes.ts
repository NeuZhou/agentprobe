/**
 * Test Report Themes - Customizable HTML report themes.
 *
 * Provides theme definitions (dark, corporate, minimal) and a theme
 * application function that injects CSS variables into HTML reports.
 */

export interface Theme {
  name: string;
  displayName: string;
  description: string;
  css: string;
}

const DARK_THEME: Theme = {
  name: 'dark',
  displayName: 'Dark',
  description: 'Default dark theme with GitHub-inspired colors',
  css: `
:root{--bg:#0d1117;--bg-card:#161b22;--border:#30363d;--text:#c9d1d9;--text-muted:#8b949e;
--green:#3fb950;--red:#f85149;--blue:#58a6ff;--purple:#bc8cff;--orange:#d29922;--cyan:#39d353;
--font:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
body{background:var(--bg);color:var(--text)}
`,
};

const CORPORATE_THEME: Theme = {
  name: 'corporate',
  displayName: 'Corporate',
  description: 'Professional light theme for business reports',
  css: `
:root{--bg:#f8f9fa;--bg-card:#ffffff;--border:#dee2e6;--text:#212529;--text-muted:#6c757d;
--green:#198754;--red:#dc3545;--blue:#0d6efd;--purple:#6f42c1;--orange:#fd7e14;--cyan:#0dcaf0;
--font:'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif}
body{background:var(--bg);color:var(--text)}
.card,.section{box-shadow:0 1px 3px rgba(0,0,0,.08)}
h1,h2{color:var(--blue)}
`,
};

const MINIMAL_THEME: Theme = {
  name: 'minimal',
  displayName: 'Minimal',
  description: 'Clean, minimal theme with muted colors',
  css: `
:root{--bg:#fafafa;--bg-card:#fff;--border:#e5e5e5;--text:#333;--text-muted:#999;
--green:#22c55e;--red:#ef4444;--blue:#3b82f6;--purple:#8b5cf6;--orange:#f59e0b;--cyan:#06b6d4;
--font:'Inter',-apple-system,BlinkMacSystemFont,sans-serif}
body{background:var(--bg);color:var(--text);max-width:900px;margin:0 auto}
.card{border:none;border-bottom:2px solid var(--border)}
.section{border:none;border-left:3px solid var(--blue);border-radius:0}
table{font-size:.9rem}
`,
};

const THEMES: Record<string, Theme> = {
  dark: DARK_THEME,
  corporate: CORPORATE_THEME,
  minimal: MINIMAL_THEME,
};

/**
 * Get a theme by name.
 */
export function getTheme(name: string): Theme | null {
  return THEMES[name] ?? null;
}

/**
 * Get all available theme names.
 */
export function getThemeNames(): string[] {
  return Object.keys(THEMES);
}

/**
 * List all themes with descriptions.
 */
export function listThemes(): Array<{ name: string; displayName: string; description: string }> {
  return Object.values(THEMES).map(t => ({
    name: t.name,
    displayName: t.displayName,
    description: t.description,
  }));
}

/**
 * Apply a theme to an HTML report by injecting/replacing the CSS variables.
 */
export function applyTheme(html: string, themeName: string): string {
  const theme = getTheme(themeName);
  if (!theme) return html;

  // Replace existing :root CSS block or inject before </head>
  const rootRegex = /:root\s*\{[^}]+\}/;
  if (rootRegex.test(html)) {
    // Extract just the :root block from theme CSS
    const themeRoot = theme.css.match(/:root\s*\{[^}]+\}/);
    if (themeRoot) {
      html = html.replace(rootRegex, themeRoot[0]);
    }
  }

  // Inject additional theme styles before </style>
  const extraStyles = theme.css.replace(/:root\s*\{[^}]+\}/, '').trim();
  if (extraStyles) {
    html = html.replace('</style>', `${extraStyles}\n</style>`);
  }

  return html;
}

/**
 * Format themes list for console output.
 */
export function formatThemes(): string {
  const lines = ['📎 Available report themes:', ''];
  for (const t of Object.values(THEMES)) {
    lines.push(`  ${t.name.padEnd(12)} ${t.displayName} - ${t.description}`);
  }
  lines.push('');
  lines.push('Usage: agentprobe report tests.yaml --theme <name>');
  return lines.join('\n');
}
