import { isAddress, isHex, getAddress, type Address } from "viem";

import {
  AVALANCHE_FUJI_NETWORK,
  atomicToUsdc,
  usdcToAtomic,
  type X402Config,
} from "./config.js";
import { X402Error } from "./errors.js";

export type PaymentRequirement = {
  scheme?: unknown;
  network?: unknown;
  asset?: unknown;
  amount?: unknown;
  payTo?: unknown;
  maxTimeoutSeconds?: unknown;
  extra?: unknown;
};

export type PaymentApproval = {
  amountAtomic: bigint;
  amountUsdc: string;
  asset: Address;
  payTo: Address;
};

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  return (
    parts[0] === 0 ||
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "::1" || hostname.endsWith(".localhost");
}

/**
 * Limits the payment tool to explicitly approved public HTTPS origins.  Local HTTP
 * is opt-in and impossible in production, keeping the agent from being an SSRF proxy.
 */
export function assertAllowedResourceUrl(rawUrl: string, config: X402Config): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new X402Error("URL_REJECTED", "La URL del recurso no es válida.");
  }

  if (url.username || url.password || url.hash || url.href.length > 2048) {
    throw new X402Error("URL_REJECTED", "La URL contiene componentes no permitidos.");
  }

  const hostname = url.hostname.toLowerCase();
  const isLocal = isLocalHostname(hostname) || isPrivateIpv4(hostname);
  if (isLocal) {
    if (!(config.allowLocalhost && url.protocol === "http:")) {
      throw new X402Error("URL_REJECTED", "Las direcciones locales o privadas no están permitidas.");
    }
    return url;
  }

  if (url.protocol !== "https:") {
    throw new X402Error("URL_REJECTED", "Solo se permiten URLs HTTPS públicas.");
  }

  if (config.allowedHosts.length === 0 || !config.allowedHosts.includes(hostname)) {
    throw new X402Error(
      "URL_REJECTED",
      "El host no está autorizado. Configúralo en X402_ALLOWED_HOSTS antes de pagar.",
    );
  }

  return url;
}

export function assertPaymentPolicy(
  requirement: PaymentRequirement,
  config: X402Config,
  requestedMaxPaymentUsdc?: string,
): PaymentApproval {
  if (requirement.scheme !== "exact") {
    throw new X402Error("PAYMENT_REJECTED_SCHEME", "Solo se permite el esquema x402 exact.");
  }
  if (requirement.network !== AVALANCHE_FUJI_NETWORK) {
    throw new X402Error("PAYMENT_REJECTED_NETWORK", "Solo se permite Avalanche Fuji eip155:43113.");
  }
  if (!isAddress(String(requirement.asset ?? ""))) {
    throw new X402Error("PAYMENT_REJECTED_ASSET", "El activo solicitado no es USDC Fuji configurado.");
  }

  const asset = getAddress(String(requirement.asset));
  if (asset !== config.usdcAddress) {
    throw new X402Error("PAYMENT_REJECTED_ASSET", "El activo solicitado no coincide con USDC Fuji configurado.");
  }

  if (typeof requirement.amount !== "string" || !/^\d+$/.test(requirement.amount)) {
    throw new X402Error("PAYMENT_REJECTED_MALFORMED", "El importe x402 no está en unidades atómicas válidas.");
  }
  const amountAtomic = BigInt(requirement.amount);
  if (amountAtomic <= 0n) {
    throw new X402Error("PAYMENT_REJECTED_MALFORMED", "El importe x402 debe ser mayor que cero.");
  }

  let effectiveLimit = config.maxPaymentAtomic;
  if (requestedMaxPaymentUsdc !== undefined) {
    const requestedLimit = usdcToAtomic(requestedMaxPaymentUsdc, "maxPaymentUsdc");
    effectiveLimit = requestedLimit < effectiveLimit ? requestedLimit : effectiveLimit;
  }
  if (amountAtomic > effectiveLimit) {
    throw new X402Error(
      "PAYMENT_REJECTED_MAX_LIMIT",
      `El pago solicitado (${atomicToUsdc(amountAtomic)} USDC) supera el límite permitido (${atomicToUsdc(effectiveLimit)} USDC).`,
    );
  }

  if (!isAddress(String(requirement.payTo ?? ""))) {
    throw new X402Error("PAYMENT_REJECTED_RECIPIENT", "El destinatario x402 no es una dirección EVM válida.");
  }
  const payTo = getAddress(String(requirement.payTo));
  if (payTo === "0x0000000000000000000000000000000000000000") {
    throw new X402Error("PAYMENT_REJECTED_RECIPIENT", "El destinatario x402 no puede ser la dirección cero.");
  }

  if (
    typeof requirement.maxTimeoutSeconds !== "number" ||
    !Number.isInteger(requirement.maxTimeoutSeconds) ||
    requirement.maxTimeoutSeconds < 1 ||
    requirement.maxTimeoutSeconds > 300
  ) {
    throw new X402Error("PAYMENT_REJECTED_TIMEOUT", "El timeout x402 debe estar entre 1 y 300 segundos.");
  }

  if (!requirement.extra || typeof requirement.extra !== "object") {
    throw new X402Error("PAYMENT_REJECTED_MALFORMED", "Los requisitos x402 no incluyen metadatos válidos.");
  }

  return {
    amountAtomic,
    amountUsdc: atomicToUsdc(amountAtomic),
    asset,
    payTo,
  };
}

export type PaymentReservation = {
  commit(): void;
  release(): void;
};

let spentAtomic = 0n;
let reservedAtomic = 0n;

/** Process-local proof-of-concept budget. It is intentionally fail-closed on signing. */
export function reserveSessionSpend(amountAtomic: bigint, config: X402Config): PaymentReservation {
  if (spentAtomic + reservedAtomic + amountAtomic > config.maxSessionSpendAtomic) {
    throw new X402Error(
      "PAYMENT_REJECTED_SESSION_LIMIT",
      `El límite de sesión (${atomicToUsdc(config.maxSessionSpendAtomic)} USDC) sería superado.`,
    );
  }

  reservedAtomic += amountAtomic;
  let complete = false;
  return {
    commit() {
      if (complete) return;
      reservedAtomic -= amountAtomic;
      spentAtomic += amountAtomic;
      complete = true;
    },
    release() {
      if (complete) return;
      reservedAtomic -= amountAtomic;
      complete = true;
    },
  };
}

export function getSessionSpendUsdc(): string {
  return atomicToUsdc(spentAtomic);
}

export function resetSessionSpendForTests(): void {
  spentAtomic = 0n;
  reservedAtomic = 0n;
}
