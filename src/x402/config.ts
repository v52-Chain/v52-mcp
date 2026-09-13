import { getAddress, isAddress, isHex, type Address, type Hex } from "viem";

import { X402Error } from "./errors.js";

export const AVALANCHE_FUJI_CHAIN_ID = 43113;
export const AVALANCHE_FUJI_NETWORK = "eip155:43113" as const;
export const AVALANCHE_FUJI_RPC_URL =
  "https://api.avax-test.network/ext/bc/C/rpc";
export const AVALANCHE_FUJI_USDC_ADDRESS =
  "0x5425890298aed601595a70AB815c96711a31Bc65" as const;
export const USDC_DECIMALS = 6;

export type X402Config = {
  rpcUrl: string;
  network: typeof AVALANCHE_FUJI_NETWORK;
  chainId: typeof AVALANCHE_FUJI_CHAIN_ID;
  usdcAddress?: Address;
  facilitatorUrl?: string;
  merchantAddress?: Address;
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

function parseOptionalAddress(value: string | undefined, name: string): Address | undefined {
  if (!value?.trim()) return undefined;
  if (!isAddress(value)) {
    throw new X402Error("X402_CONFIGURATION_INVALID", `${name} debe ser una dirección EVM válida.`);
  }
  return getAddress(value);
}

function parseOptionalUrl(value: string | undefined, name: string): string | undefined {
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
  const chainId = Number(env.AVALANCHE_CHAIN_ID ?? AVALANCHE_FUJI_CHAIN_ID);
  if (chainId !== AVALANCHE_FUJI_CHAIN_ID) {
    throw new X402Error(
      "X402_CONFIGURATION_INVALID",
      `AVALANCHE_CHAIN_ID debe ser ${AVALANCHE_FUJI_CHAIN_ID}; mainnet no está permitido.`,
    );
  }

  const network = env.X402_NETWORK ?? AVALANCHE_FUJI_NETWORK;
  if (network !== AVALANCHE_FUJI_NETWORK) {
    throw new X402Error(
      "X402_CONFIGURATION_INVALID",
      `X402_NETWORK debe ser ${AVALANCHE_FUJI_NETWORK}; mainnet no está permitido.`,
    );
  }

  const privateKey = env.X402_AGENT_PRIVATE_KEY?.trim();
  if (privateKey && (!isHex(privateKey) || privateKey.length !== 66)) {
    throw new X402Error(
      "X402_CONFIGURATION_INVALID",
      "X402_AGENT_PRIVATE_KEY debe ser una clave privada EVM válida.",
    );
  }

  const allowLocalhost =
    envBoolean(env.X402_ALLOW_LOCALHOST) && env.NODE_ENV !== "production";

  return {
    rpcUrl: parseOptionalUrl(env.AVALANCHE_RPC_URL, "AVALANCHE_RPC_URL") ?? AVALANCHE_FUJI_RPC_URL,
    network: AVALANCHE_FUJI_NETWORK,
    chainId: AVALANCHE_FUJI_CHAIN_ID,
    usdcAddress: parseOptionalAddress(env.X402_USDC_ADDRESS, "X402_USDC_ADDRESS"),
    facilitatorUrl: parseOptionalUrl(env.X402_FACILITATOR_URL, "X402_FACILITATOR_URL"),
    merchantAddress: parseOptionalAddress(env.X402_MERCHANT_ADDRESS, "X402_MERCHANT_ADDRESS"),
    agentPrivateKey: privateKey as Hex | undefined,
    maxPaymentAtomic: usdcToAtomic(env.X402_MAX_PAYMENT_USDC ?? "0.05", "X402_MAX_PAYMENT_USDC"),
    maxSessionSpendAtomic: usdcToAtomic(
      env.X402_MAX_SESSION_SPEND_USDC ?? "0.10",
      "X402_MAX_SESSION_SPEND_USDC",
    ),
    allowedHosts: (env.X402_ALLOWED_HOSTS ?? "")
      .split(",")
      .map(host => host.trim().toLowerCase())
      .filter(Boolean),
    allowLocalhost,
    debug: envBoolean(env.X402_DEBUG),
  };
}

export function requireX402ServerConfig(config: X402Config): asserts config is X402Config & {
  usdcAddress: Address;
  facilitatorUrl: string;
  merchantAddress: Address;
} {
  if (!config.usdcAddress || !config.facilitatorUrl || !config.merchantAddress) {
    throw new X402Error(
      "X402_SERVER_NOT_CONFIGURED",
      "Configura X402_USDC_ADDRESS, X402_FACILITATOR_URL y X402_MERCHANT_ADDRESS para habilitar la demo x402.",
    );
  }
}

export function requireX402ClientConfig(config: X402Config): asserts config is X402Config & {
  usdcAddress: Address;
  facilitatorUrl: string;
  agentPrivateKey: Hex;
} {
  if (!config.usdcAddress || !config.facilitatorUrl || !config.agentPrivateKey) {
    throw new X402Error(
      "X402_CLIENT_NOT_CONFIGURED",
      "Configura X402_USDC_ADDRESS, X402_FACILITATOR_URL y X402_AGENT_PRIVATE_KEY antes de pagar.",
    );
  }
}

export function getX402ConfigurationStatus(env: NodeJS.ProcessEnv = process.env) {
  try {
    const config = loadX402Config(env);
    return {
      configured: Boolean(config.usdcAddress && config.facilitatorUrl && config.agentPrivateKey),
      demoConfigured: Boolean(
        config.usdcAddress && config.facilitatorUrl && config.merchantAddress,
      ),
      network: config.network,
      chainId: config.chainId,
      facilitatorConfigured: Boolean(config.facilitatorUrl),
      merchantConfigured: Boolean(config.merchantAddress),
      walletConfigured: Boolean(config.agentPrivateKey),
      assetConfigured: Boolean(config.usdcAddress),
      maxPaymentUsdc: atomicToUsdc(config.maxPaymentAtomic),
    };
  } catch {
    return {
      configured: false,
      demoConfigured: false,
      network: AVALANCHE_FUJI_NETWORK,
      chainId: AVALANCHE_FUJI_CHAIN_ID,
      facilitatorConfigured: false,
      merchantConfigured: false,
      walletConfigured: false,
      assetConfigured: false,
      maxPaymentUsdc: "0.05",
    };
  }
}
