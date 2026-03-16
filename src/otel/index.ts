/**
 * Enhanced OpenTelemetry module — AgentProbe v4.12.0
 *
 * Re-exports all OTel sub-modules for convenient access.
 */

export { AgentProbeExporter } from './exporter';
export type { AgentProbeExporterConfig, TestResults } from './exporter';

export { TraceAnalyzer } from './analyzer';
export type { TraceAnalysis, Bottleneck, Anomaly } from './analyzer';

export { TraceVisualizer } from './visualizer';

export { DistributedTracer } from './distributed';
export type { TraceContext, CorrelatedTrace, AgentTimeline, CrossAgentCall } from './distributed';
