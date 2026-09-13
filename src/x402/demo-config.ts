/**
 * Config for the local x402 demo/test fixture only (`npm run x402:demo` /
 * `npm run x402:test`). The real MCP tools never import this module: a
 * facilitator and a merchant address only matter to whoever plays the
 * "resource server" role, and in production that's v52-backend, not this
 * process. This fixture plays that role locally so the payment flow can be
 * exercised end to end without a live backend.
 */
import type { Address } from "viem";

import { loadX402Config, parseOptionalAddress, parseOptionalUrl, type X402Config } from "./config.js";
import { X402Error } from "./errors.js";

export type X402DemoConfig = X402Config & { facilitatorUrl: string; merchantAddress: Address };

export function loadX402DemoConfig(env: NodeJS.ProcessEnv = process.env): X402DemoConfig {
  const facilitatorUrl = parseOptionalUrl(env.X402_FACILITATOR_URL, "X402_FACILITATOR_URL");
  const merchantAddress = parseOptionalAddress(env.X402_MERCHANT_ADDRESS, "X402_MERCHANT_ADDRESS");

  if (!facilitatorUrl || !merchantAddress) {
    throw new X402Error(
      "X402_SERVER_NOT_CONFIGURED",
      "Configura X402_FACILITATOR_URL y X402_MERCHANT_ADDRESS para habilitar el fixture x402 local.",
    );
  }

  return { ...loadX402Config(env), facilitatorUrl, merchantAddress };
}
