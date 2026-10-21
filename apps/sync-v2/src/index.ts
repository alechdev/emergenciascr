/**
 * Telemetry has to start before any other module is evaluated: the metrics API has no proxy
 * provider, so meters created earlier (such as the SIGAE client's) would stay no-ops. The rest
 * of the service is loaded with a dynamic import, which import sorting can't move ahead.
 */
import { telemetry } from "@/instrumentation";

const { run } = await import("@/main");
run(telemetry);
