import { isSpanContextValid, trace } from "@opentelemetry/api";
import { OpenTelemetryTransportV3 } from "@opentelemetry/winston-transport";
import winston from "winston";

import { serializeError } from "@/lib/errors";

/**
 * Log fields are fixed names, never interpolated into the message: `incidentId`, `jobId`,
 * `queue`, `endpoint`, `outcome`, `codigo`, `errorKind`, `durationMs`, `error`.
 * Never log SIGAE bodies (the report holds personal data), credentials or the proxy URL.
 */
export type LogFields = Record<string, unknown>;

/** Errors anywhere in the top-level fields become JSON with their whole cause chain. */
const errors = winston.format((info) => {
  for (const key of Object.keys(info)) {
    const value = info[key];
    if (value instanceof Error) info[key] = serializeError(value);
  }
  return info;
});

/**
 * Stdout only: OTel log records get the active span from the context on their own.
 */
const traceContext = winston.format((info) => {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (spanContext && isSpanContextValid(spanContext)) {
    info.traceId = spanContext.traceId;
    info.spanId = spanContext.spanId;
  }
  return info;
});

const development = winston.format.combine(
  traceContext(),
  winston.format.colorize(),
  winston.format.printf(({ level, message, timestamp, ...fields }) => {
    const rest = Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : "";
    return `${String(timestamp)} ${level} ${String(message)}${rest}`;
  })
);

const production = winston.format.combine(traceContext(), winston.format.json());

export function createLogger(options: { level: string; pretty: boolean }): winston.Logger {
  return winston.createLogger({
    level: options.level,
    format: winston.format.combine(errors(), winston.format.timestamp()),
    transports: [
      new winston.transports.Console({ format: options.pretty ? development : production }),
      new OpenTelemetryTransportV3()
    ]
  });
}

// Reads process.env directly so the logger works before (and when) env validation fails.
const logger = createLogger({
  level: process.env.LOG_LEVEL || "info",
  pretty: process.env.NODE_ENV === "development"
});

export default logger;
