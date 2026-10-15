import {
  type Attributes,
  type Counter,
  type Histogram,
  type MeterProvider,
  type Tracer,
  type TracerProvider,
  metrics,
  trace
} from "@opentelemetry/api";

const INSTRUMENTATION_NAME = "@bomberoscr/sigae";

export interface ClientTelemetry {
  tracer: Tracer;
  requests: Counter<Attributes>;
  duration: Histogram<Attributes>;
}

/**
 * Uses the global providers unless given others. Without an OTel SDK these are no-ops.
 * The metrics API has no proxy provider, so start the SDK before creating the client.
 */
export function createClientTelemetry(options: {
  tracerProvider?: TracerProvider;
  meterProvider?: MeterProvider;
}): ClientTelemetry {
  const tracer = (options.tracerProvider ?? trace.getTracerProvider()).getTracer(
    INSTRUMENTATION_NAME
  );
  const meter = (options.meterProvider ?? metrics.getMeterProvider()).getMeter(
    INSTRUMENTATION_NAME
  );
  return {
    tracer,
    requests: meter.createCounter("sigae.client.requests", {
      description: "SIGAE requests by endpoint and outcome"
    }),
    duration: meter.createHistogram("sigae.client.request.duration", {
      description: "SIGAE request duration, excluding time waiting for a concurrency slot",
      unit: "s"
    })
  };
}
