/**
 * Trace anonymizer — remove sensitive data before sharing.
 *
 * Detects and replaces:
 * - API keys / tokens / secrets
 * - Email addresses
 * - IP addresses
 * - Common name patterns (optional)
 * - Phone numbers
 * - URLs with credentials
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
  /** Additional regex patterns to redact */
  custom?: Array<{ pattern: string; replacement: string }>;
}

const DEFAULT_OPTIONS: Required<Omit<AnonymizeOptions, 'custom'>> = {
  names: true,
  emails: true,
  ips: true,
  secrets: true,
  phones: true,
};

// Patterns for API keys / secrets / tokens
const SECRET_PATTERNS: RegExp[] = [
  // Generic API key patterns (long hex/base64 strings preceded by key-like identifiers)
  /(?:api[_-]?key|api[_-]?secret|access[_-]?token|secret[_-]?key|auth[_-]?token|bearer)\s*[=:]\s*["']?([A-Za-z0-9+/=_\-]{20,})["']?/gi,
  // AWS keys
  /AKIA[0-9A-Z]{16}/g,
  // OpenAI keys
  /sk-[A-Za-z0-9]{20,}/g,
  // Anthropic keys
  /sk-ant-[A-Za-z0-9\-]{20,}/g,
  // GitHub tokens
  /gh[ps]_[A-Za-z0-9]{36,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  // Bearer tokens in headers
  /Bearer\s+[A-Za-z0-9+/=_\-.]{20,}/gi,
  // Generic long hex strings (likely tokens)
  /(?:token|key|secret|password|passwd|pwd)\s*[=:]\s*["']?([a-f0-9]{32,})["']?/gi,
];

const EMAIL_PATTERN = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const IP_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const PHONE_PATTERN = /(?:\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;

// Simple name detection: capitalized words that look like names
// This is a heuristic and will have false positives
const NAME_PATTERN = /\b(?:Mr|Mrs|Ms|Dr|Prof)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?/g;

let ipCounter = 1;
const ipMap = new Map<string, string>();

function anonymizeIp(ip: string): string {
  if (ip === '127.0.0.1' || ip === '0.0.0.0') return ip; // Keep localhost
  if (!ipMap.has(ip)) {
    ipMap.set(ip, `192.168.x.${ipCounter++}`);
  }
  return ipMap.get(ip)!;
}

/**
 * Anonymize a string by replacing sensitive patterns.
 */
export function anonymizeString(input: string, options: AnonymizeOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let result = input;

  if (opts.secrets) {
    for (const pattern of SECRET_PATTERNS) {
      // Reset lastIndex for global patterns
      pattern.lastIndex = 0;
      result = result.replace(pattern, (match) => {
        // Keep the key name but redact the value
        const eqIdx = match.search(/[=:]/);
        if (eqIdx >= 0) {
          return match.slice(0, eqIdx + 1) + ' [REDACTED]';
        }
        return '[REDACTED]';
      });
    }
  }

  if (opts.emails) {
    result = result.replace(EMAIL_PATTERN, 'user@example.com');
  }

  if (opts.ips) {
    result = result.replace(IP_PATTERN, (ip) => anonymizeIp(ip));
  }

  if (opts.phones) {
    result = result.replace(PHONE_PATTERN, '[PHONE]');
  }

  if (opts.names) {
    result = result.replace(NAME_PATTERN, '[NAME]');
  }

  // Custom patterns
  if (options.custom) {
    for (const { pattern, replacement } of options.custom) {
      result = result.replace(new RegExp(pattern, 'g'), replacement);
    }
  }

  return result;
}

/**
 * Deep-anonymize a JSON-serializable object.
 */
export function anonymize(data: any, options: AnonymizeOptions = {}): any {
  // Reset IP counter for consistent results
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
      // Redact entire values of sensitive-looking keys
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
