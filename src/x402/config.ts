import { getAddress, isAddress, isHex, type Address, type Hex } from "viem";

import { X402Error } from "./errors.js";

export const AVALANCHE_FUJI_CHAIN_ID = 43113;
export const AVALANCHE_FUJI_NETWORK = "eip155:43113" as const;
export const AVALANCHE_FUJI_RPC_URL =
  "https://api.avax-test.network/ext/bc/C/rpc";
export const AVALANCHE_FUJI_USDC_ADDRESS =
  "0x5425890298aed601595a70AB815c96711a31Bc65" as const;
export const USDC_DECIMALS = 6;

// Fixed by design: every paid tool ultimately pays this one backend (see
// vector52/backend.ts). It's hardcoded, not user input, so it's always an
// allowed payment target regardless of X402_ALLOWED_HOSTS — that allowlist
// exists to stop avalanche_x402_fetch from being used as an SSRF proxy
// against arbitrary *user-supplied* hosts, not to gate our own fixed target.
export const V52_BACKEND_URL = "https://v52-backend.onrender.com";
const V52_BACKEND_HOSTNAME = new URL(V52_BACKEND_URL).hostname;

export type X402Config = {
  rpcUrl: string;
  network: typeof AVALANCHE_FUJI_NETWORK;
  chainId: typeof AVALANCHE_FUJI_CHAIN_ID;
  usdcAddress: Address;
  agentPrivateKey?: Hex;
  maxPaymentAtomic: bigint;
  maxSessionSpendAtomic: bigint;
  allowedHosts: string[];
  allowLocalhost: boolean;
  debug: boolean;
};

function envBoolean(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

export function parseOptionalAddress(value: string | undefined, name: string): Address | undefined {
  if (!value?.trim()) return undefined;
  if (!isAddress(value)) {
    throw new X402Error("X402_CONFIGURATION_INVALID", `${name} debe ser una dirección EVM válida.`);
  }
  return getAddress(value);
}

export function parseOptionalUrl(value: string | undefined, name: string): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      throw new Error("protocol");
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new X402Error("X402_CONFIGURATION_INVALID", `${name} debe ser una URL HTTPS válida.`);
  }
}

/** Converts a decimal USDC value to its six-decimal atomic representation without floats. */
export function usdcToAtomic(value: string, name = "importe"): bigint {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(normalized)) {
    throw new X402Error(
      "X402_CONFIGURATION_INVALID",
      `${name} debe ser un importe USDC positivo con hasta 6 decimales.`,
    );
  }

  const [whole, fraction = ""] = normalized.split(".");
  const atomic = BigInt(whole) * 10n ** BigInt(USDC_DECIMALS) + BigInt(fraction.padEnd(USDC_DECIMALS, "0"));
  if (atomic <= 0n) {
    throw new X402Error("X402_CONFIGURATION_INVALID", `${name} debe ser mayor que cero.`);
  }
  return atomic;
}

export function atomicToUsdc(value: bigint): string {
  const whole = value / 10n ** BigInt(USDC_DECIMALS);
  const fraction = (value % 10n ** BigInt(USDC_DECIMALS))
    .toString()
    .padStart(USDC_DECIMALS, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function loadX402Config(env: NodeJS.ProcessEnv = process.env): X402Config {
  // Network, chain ID and the USDC contract are fixed: this integration only
  // ever targets Avalanche Fuji USDC, so there is nothing legitimate to
  // override here (an env var that can only ever hold one legal value is
  // not configuration, it's noise).
  // Many wallet exports omit the 0x prefix; accept a bare 64-char hex string
  // too instead of rejecting an otherwise-valid key over a cosmetic detail.
  const trimmedKey = env.X402_AGENT_PRIVATE_KEY?.trim();
  const privateKey =
    trimmedKey && !trimmedKey.startsWith("0x") && /^[0-9a-fA-F]{64}$/.test(trimmedKey)
      ? `0x${trimmedKey}`
      : trimmedKey;
  if (privateKey && (!isHex(privateKey) || privateKey.length !== 66)) {
    throw new X402Error(
      "X402_CONFIGURATION_INVALID",
      "X402_AGENT_PRIVATE_KEY debe ser una clave privada EVM válida (32 bytes en hexadecimal, con o sin prefijo 0x).",
    );
  }

  const allowLocalhost =
    envBoolean(env.X402_ALLOW_LOCALHOST) && env.NODE_ENV !== "production";

  return {
    rpcUrl: parseOptionalUrl(env.AVALANCHE_RPC_URL, "AVALANCHE_RPC_URL") ?? AVALANCHE_FUJI_RPC_URL,
    network: AVALANCHE_FUJI_NETWORK,
    chainId: AVALANCHE_FUJI_CHAIN_ID,
    usdcAddress: AVALANCHE_FUJI_USDC_ADDRESS,
    agentPrivateKey: privateKey as Hex | undefined,
    maxPaymentAtomic: usdcToAtomic(env.X402_MAX_PAYMENT_USDC ?? "0.05", "X402_MAX_PAYMENT_USDC"),
    maxSessionSpendAtomic: usdcToAtomic(
      env.X402_MAX_SESSION_SPEND_USDC ?? "0.10",
      "X402_MAX_SESSION_SPEND_USDC",
    ),
    allowedHosts: Array.from(
      new Set([
        V52_BACKEND_HOSTNAME,
        ...(env.X402_ALLOWED_HOSTS ?? "")
          .split(",")
          .map(host => host.trim().toLowerCase())
          .filter(Boolean),
      ]),
    ),
    allowLocalhost,
    debug: envBoolean(env.X402_DEBUG),
  };
}

/**
 * Guards the real payment path (fetchX402Resource): the only thing it
 * actually needs is a wallet to sign with. usdcAddress is always present
 * (it's a fixed constant, not user config), so the sole real gate is the key.
 */
export function requireX402ClientConfig(config: X402Config): asserts config is X402Config & {
  agentPrivateKey: Hex;
} {
  if (!config.agentPrivateKey) {
    throw new X402Error(
      "X402_CLIENT_NOT_CONFIGURED",
      "Configura X402_AGENT_PRIVATE_KEY antes de pagar.",
    );
  }
}

export function getX402ConfigurationStatus(env: NodeJS.ProcessEnv = process.env) {
  const config = loadX402Config(env);
  return {
    configured: Boolean(config.agentPrivateKey),
    network: config.network,
    chainId: config.chainId,
    walletConfigured: Boolean(config.agentPrivateKey),
    maxPaymentUsdc: atomicToUsdc(config.maxPaymentAtomic),
  };
}
