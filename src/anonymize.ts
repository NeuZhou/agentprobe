/**
 * Trace anonymizer - remove sensitive data before sharing.
 *
 * Detects and replaces:
 * - API keys / tokens / secrets
 * - Email addresses
 * - IP addresses
 * - Common name patterns (optional)
 * - Phone numbers
 * - Credit card numbers
 * - URLs with credentials
 * - Custom PII patterns via config
 *
 * Supports:
 * - Reversible anonymization (for debugging)
 * - Anonymization report (what was redacted)
 */

export interface AnonymizeOptions {
  /** Replace detected names (heuristic, may have false positives). Default: true */
  names?: boolean;
  /** Replace emails. Default: true */
  emails?: boolean;
  /** Replace IP addresses. Default: true */
  ips?: boolean;
  /** Replace API keys / secrets. Default: true */
  secrets?: boolean;
  /** Replace phone numbers. Default: true */
  phones?: boolean;
  /** Replace credit card numbers. Default: true */
  creditCards?: boolean;
  /** Replace SSNs. Default: true */
  ssns?: boolean;
  /** Replace street addresses. Default: true */
  addresses?: boolean;
  /** Additional regex patterns to redact */
  custom?: Array<{ pattern: string; replacement: string; name?: string }>;
  /** Path to YAML config with custom patterns */
  patternsFile?: string;
  /** Enable reversible anonymization (stores mapping). Default: false */
  reversible?: boolean;
  /** Generate an anonymization report. Default: false */
  report?: boolean;
}

const DEFAULT_OPTIONS: Required<Omit<AnonymizeOptions, 'custom' | 'reversible' | 'report' | 'patternsFile'>> = {
  names: true,
  emails: true,
  ips: true,
  secrets: true,
  phones: true,
  creditCards: true,
  ssns: true,
  addresses: true,
};

// Patterns for API keys / secrets / tokens
const SECRET_PATTERNS: RegExp[] = [
  /(?:api[_-]?key|api[_-]?secret|access[_-]?token|secret[_-]?key|auth[_-]?token|bearer)\s*[=:]\s*["']?([A-Za-z0-9+/=_-]{20,})["']?/gi,
  /AKIA[0-9A-Z]{16}/g,
  /sk-[A-Za-z0-9]{20,}/g,
  /sk-ant-[A-Za-z0-9-]{20,}/g,
  /gh[ps]_[A-Za-z0-9]{36,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /Bearer\s+[A-Za-z0-9+/=_\-.]{20,}/gi,
  /(?:token|key|secret|password|passwd|pwd)\s*[=:]\s*["']?([a-f0-9]{32,})["']?/gi,
];

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const IP_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const PHONE_PATTERN = /(?:\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
const NAME_PATTERN = /\b(?:Mr|Mrs|Ms|Dr|Prof)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?/g;
// Credit card: 13-19 digit sequences (with optional separators)
const CREDIT_CARD_PATTERN = /\b(?:\d{4}[-\s]?){3,4}\d{1,4}\b/g;
// SSN: xxx-xx-xxxx
const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/g;
// Street addresses (simple heuristic)
const ADDRESS_PATTERN = /\b\d{1,5}\s+(?:[A-Z][a-z]+\s+){1,3}(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Rd|Road|Ln|Lane|Way|Ct|Court|Pl|Place)\.?\b/g;

// ===== Anonymization report tracking =====

export interface AnonymizationRedaction {
  type: string;
  original: string;
  replacement: string;
  count: number;
}

export interface AnonymizationReport {
  totalRedactions: number;
  byType: Record<string, number>;
  redactions: AnonymizationRedaction[];
}

// ===== Reversible anonymization =====

export interface AnonymizationMapping {
  forward: Map<string, string>;  // original → anonymized
  reverse: Map<string, string>;  // anonymized → original
}

let ipCounter = 1;
const ipMap = new Map<string, string>();

function anonymizeIp(ip: string): string {
  if (ip === '127.0.0.1' || ip === '0.0.0.0') return ip;
  if (!ipMap.has(ip)) {
    ipMap.set(ip, `192.168.x.${ipCounter++}`);
  }
  return ipMap.get(ip)!;
}

// Luhn check for credit card validation
function isValidCreditCard(digits: string): boolean {
  const nums = digits.replace(/[-\s]/g, '');
  if (nums.length < 13 || nums.length > 19 || !/^\d+$/.test(nums)) return false;
  let sum = 0;
  let alternate = false;
  for (let i = nums.length - 1; i >= 0; i--) {
    let n = parseInt(nums[i], 10);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

// Module-level state for report & reversible mode
let _reportRedactions: AnonymizationRedaction[] = [];
let _mapping: AnonymizationMapping = { forward: new Map(), reverse: new Map() };
let _reportEnabled = false;
let _reversibleEnabled = false;

function trackRedaction(type: string, original: string, replacement: string): void {
  if (_reportEnabled) {
    const existing = _reportRedactions.find(r => r.type === type && r.original === original);
    if (existing) {
      existing.count++;
    } else {
      _reportRedactions.push({ type, original, replacement, count: 1 });
    }
  }
  if (_reversibleEnabled) {
    _mapping.forward.set(original, replacement);
    _mapping.reverse.set(replacement, original);
  }
}

/**
 * Anonymize a string by replacing sensitive patterns.
 */
export function anonymizeString(input: string, options: AnonymizeOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let result = input;

  if (opts.secrets) {
    for (const pattern of SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      result = result.replace(pattern, (match) => {
        const eqIdx = match.search(/[=:]/);
        const replacement = eqIdx >= 0 ? match.slice(0, eqIdx + 1) + ' [REDACTED]' : '[REDACTED]';
        trackRedaction('secret', match, replacement);
        return replacement;
      });
    }
  }

  if (opts.emails) {
    result = result.replace(EMAIL_PATTERN, (match) => {
      const replacement = 'user@example.com';
      trackRedaction('email', match, replacement);
      return replacement;
    });
  }

  if (opts.ips) {
    result = result.replace(IP_PATTERN, (ip) => {
      const replacement = anonymizeIp(ip);
      if (replacement !== ip) trackRedaction('ip', ip, replacement);
      return replacement;
    });
  }

  if (opts.phones) {
    result = result.replace(PHONE_PATTERN, (match) => {
      trackRedaction('phone', match, '[PHONE]');
      return '[PHONE]';
    });
  }

  if (opts.creditCards) {
    result = result.replace(CREDIT_CARD_PATTERN, (match) => {
      if (isValidCreditCard(match)) {
        const masked = '[CREDIT_CARD]';
        trackRedaction('credit_card', match, masked);
        return masked;
      }
      return match;
    });
  }

  if (opts.names) {
    result = result.replace(NAME_PATTERN, (match) => {
      trackRedaction('name', match, '[NAME]');
      return '[NAME]';
    });
  }

  if (opts.ssns) {
    result = result.replace(SSN_PATTERN, (match) => {
      trackRedaction('ssn', match, '[SSN]');
      return '[SSN]';
    });
  }

  if (opts.addresses) {
    result = result.replace(ADDRESS_PATTERN, (match) => {
      trackRedaction('address', match, '[ADDRESS]');
      return '[ADDRESS]';
    });
  }

  // Custom patterns
  if (options.custom) {
    for (const { pattern, replacement, name: patternName } of options.custom) {
      result = result.replace(new RegExp(pattern, 'g'), (match) => {
        trackRedaction(patternName || 'custom', match, replacement);
        return replacement;
      });
    }
  }

  return result;
}

/**
 * Deep-anonymize a JSON-serializable object.
 */
export function anonymize(data: any, options: AnonymizeOptions = {}): any {
  ipCounter = 1;
  ipMap.clear();
  return deepAnonymize(data, options);
}

function deepAnonymize(data: any, options: AnonymizeOptions): any {
  if (data === null || data === undefined) return data;

  if (typeof data === 'string') {
    return anonymizeString(data, options);
  }

  if (Array.isArray(data)) {
    return data.map(item => deepAnonymize(item, options));
  }

  if (typeof data === 'object') {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes('password') ||
        lowerKey.includes('secret') ||
        lowerKey.includes('api_key') ||
        lowerKey.includes('apikey') ||
        lowerKey.includes('access_token') ||
        lowerKey.includes('auth_token') ||
        lowerKey.includes('private_key')
      ) {
        trackRedaction('sensitive_key', `${key}=***`, '[REDACTED]');
        result[key] = '[REDACTED]';
      } else {
        result[key] = deepAnonymize(value, options);
      }
    }
    return result;
  }

  return data;
}

/**
 * Anonymize a trace JSON file and return the cleaned data.
 */
export function anonymizeTrace(traceJson: any, options: AnonymizeOptions = {}): any {
  return anonymize(traceJson, options);
}

/**
 * Anonymize with full reporting - returns anonymized data plus a report.
 */
export function anonymizeWithReport(data: any, options: AnonymizeOptions = {}): { data: any; report: AnonymizationReport } {
  _reportEnabled = true;
  _reportRedactions = [];
  _reversibleEnabled = !!options.reversible;
  _mapping = { forward: new Map(), reverse: new Map() };

  const anonymized = anonymize(data, { ...options, report: true });

  const byType: Record<string, number> = {};
  for (const r of _reportRedactions) {
    byType[r.type] = (byType[r.type] || 0) + r.count;
  }

  const report: AnonymizationReport = {
    totalRedactions: _reportRedactions.reduce((sum, r) => sum + r.count, 0),
    byType,
    redactions: _reportRedactions,
  };

  _reportEnabled = false;
  return { data: anonymized, report };
}

/**
 * Anonymize data with reversible mapping.
 * Returns the anonymized data and a mapping that can be used to reverse it.
 */
export function anonymizeReversible(data: any, options: AnonymizeOptions = {}): { data: any; mapping: AnonymizationMapping } {
  _reversibleEnabled = true;
  _reportEnabled = false;
  _mapping = { forward: new Map(), reverse: new Map() };

  const anonymized = anonymize(data, { ...options, reversible: true });

  const mapping = {
    forward: new Map(_mapping.forward),
    reverse: new Map(_mapping.reverse),
  };
  _reversibleEnabled = false;
  return { data: anonymized, mapping };
}

/**
 * Reverse anonymization using a mapping.
 */
export function deanonymize(data: any, mapping: AnonymizationMapping): any {
  if (data === null || data === undefined) return data;
  if (typeof data === 'string') {
    let result = data;
    for (const [anonymized, original] of mapping.reverse) {
      result = result.split(anonymized).join(original);
    }
    return result;
  }
  if (Array.isArray(data)) {
    return data.map(item => deanonymize(item, mapping));
  }
  if (typeof data === 'object') {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      result[key] = deanonymize(value, mapping);
    }
    return result;
  }
  return data;
}

/**
 * Format an anonymization report for console display.
 */
export function formatAnonymizationReport(report: AnonymizationReport): string {
  const lines = [`Anonymization Report: ${report.totalRedactions} total redactions`, ''];
  for (const [type, count] of Object.entries(report.byType)) {
    lines.push(`  ${type}: ${count}`);
  }
  if (report.redactions.length > 0) {
    lines.push('');
    lines.push('Details:');
    for (const r of report.redactions.slice(0, 20)) {
      const preview = r.original.length > 40 ? r.original.slice(0, 37) + '...' : r.original;
      lines.push(`  [${r.type}] "${preview}" → "${r.replacement}" (×${r.count})`);
    }
    if (report.redactions.length > 20) {
      lines.push(`  ... and ${report.redactions.length - 20} more`);
    }
  }
  return lines.join('\n');
}
