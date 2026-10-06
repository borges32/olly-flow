export {
  endpointProblems,
  rateLimitedDiag,
  startTelemetry,
  telemetryEnabled,
  type TelemetryHandle,
} from './sdk.js';
export { activeTraceIds, extractTraceContext, injectTraceContext } from './context.js';
export { ollyMetrics, resetMetricsForTests } from './metrics.js';
export { otelLogDestination } from './logs.js';
