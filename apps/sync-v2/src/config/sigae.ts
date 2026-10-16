import { createSigaeClient } from "@bomberoscr/sigae/client";

import env from "@/config/env";

let lastSuccessAt: number | undefined;

export const sigae = createSigaeClient({
  baseUrl: env.SIGAE_API_URL,
  credentials: {
    user: env.SIGAE_USER,
    password: env.SIGAE_PASSWORD,
    systemCode: env.SIGAE_COD_SYS,
    ip: env.SIGAE_IP
  },
  proxy: env.SIGAE_PROXY_URL,
  onResponse: (event) => {
    if (event.outcome === "ok") lastSuccessAt = Date.now();
  }
});

/** Time of the last `00` answer from SIGAE, in milliseconds since the epoch. */
export function lastSigaeSuccessAt(): number | undefined {
  return lastSuccessAt;
}
