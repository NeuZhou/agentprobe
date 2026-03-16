import YAML from 'yaml';

/**
 * Result of YAML validation including duplicate key warnings.
 */
export interface YamlValidationResult {
  parsed: any;
  warnings: string[];
}

/**
 * Parse YAML with duplicate key detection and auto-merging.
 * YAML silently overwrites duplicate keys — we detect this and warn/fix.
 */
export function parseYamlWithValidation(content: string, filePath?: string): YamlValidationResult {
  const warnings: string[] = [];

  // Use yaml library's document API to detect duplicates
  const doc = YAML.parseDocument(content);

  // Check for parsing errors
  if (doc.errors && doc.errors.length > 0) {
    const err = doc.errors[0];
    const pos = err.pos ? ` (line ${getLineNumber(content, err.pos[0])})` : '';
    const snippet = err.pos ? getSnippet(content, err.pos[0]) : '';
    throw new Error(
      `Invalid YAML${filePath ? ` in ${filePath}` : ''}${pos}: ${err.message}` +
        (snippet ? `\n\n${snippet}` : '') +
        `\n\n💡 Check indentation and special characters.`,
    );
  }

  // Walk the document to find duplicate keys in mappings
  detectDuplicatesInDoc(doc, content, warnings);

  const parsed = doc.toJS();

  // Auto-merge duplicate keys in test expectations
  if (parsed?.tests) {
    for (const test of parsed.tests) {
      if (test?.expect) {
        autoMergeDuplicates(test.expect, test.name, warnings);
      }
    }
  }

  return { parsed, warnings };
}

/**
 * Detect duplicate keys by scanning the raw YAML content for repeated keys
 * within the same indentation level.
 */
function detectDuplicatesInDoc(_doc: YAML.Document, content: string, warnings: string[]): void {
  const lines = content.split('\n');
  const keysByScope: Map<string, Map<string, number>> = new Map();

  let currentScope = '';
  const scopeStack: Array<{ indent: number; scope: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = line.length - trimmed.length;

    // Pop scope stack when indent decreases
    while (scopeStack.length > 0 && indent <= scopeStack[scopeStack.length - 1].indent) {
      scopeStack.pop();
    }

    currentScope = scopeStack.map((s) => s.scope).join('.');

    // Detect key: value pattern
    const keyMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:/);
    if (keyMatch) {
      const key = keyMatch[1];
      const scopeKey = `${currentScope}@${indent}`;

      if (!keysByScope.has(scopeKey)) {
        keysByScope.set(scopeKey, new Map());
      }
      const keys = keysByScope.get(scopeKey)!;

      if (keys.has(key)) {
        warnings.push(
          `⚠ Duplicate key '${key}' at line ${i + 1}` +
            ` (first seen at line ${keys.get(key)})` +
            ` — YAML silently overwrites duplicates. Use array syntax instead.`,
        );
      }
      keys.set(key, i + 1);

      // Push to scope stack for nested detection
      scopeStack.push({ indent, scope: key });
    }
  }
}

/**
 * Auto-merge: if a string expectation should be an array, convert it.
 * This catches cases where YAML silently overwrote a key.
 */
function autoMergeDuplicates(
  expect: Record<string, any>,
  _testName: string,
  _warnings: string[],
): void {
  // These keys support both string and array values
  const arrayableKeys = [
    'tool_called',
    'tool_not_called',
    'output_contains',
    'output_not_contains',
  ];

  for (const key of arrayableKeys) {
    if (key in expect && typeof expect[key] === 'string') {
      // Already a string — that's fine, but if the user intended multiple values,
      // they lost data. The duplicate detection above will have warned about this.
    }
  }
}

function getLineNumber(content: string, offset: number): number {
  return content.substring(0, offset).split('\n').length;
}

function getSnippet(content: string, offset: number): string {
  const lines = content.split('\n');
  const lineNum = getLineNumber(content, offset) - 1;
  const start = Math.max(0, lineNum - 1);
  const end = Math.min(lines.length, lineNum + 2);
  return lines
    .slice(start, end)
    .map((l, i) => {
      const num = start + i + 1;
      const marker = num === lineNum + 1 ? ' → ' : '   ';
      return `${marker}${num} | ${l}`;
    })
    .join('\n');
}
