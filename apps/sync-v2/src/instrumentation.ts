/**
 * Starts telemetry on import. Only the entry point imports this, before it loads the rest of
 * the service (see `index.ts`).
 */
import env from "@/config/env";
import { startTelemetry } from "@/telemetry";

export const telemetry = startTelemetry({ env });
