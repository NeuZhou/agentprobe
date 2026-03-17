/**
 * AgentProbe Integrations
 *
 * Optional integrations with external security and quality tools.
 */

export {
  ClawGuardIntegration,
  isClawGuardAvailable,
  runSecurityScan,
  createSecurityScanAssertion,
  type ClawGuardOptions,
  type ClawGuardFinding,
  type ClawGuardScanResult,
  type Severity,
} from './clawguard';
