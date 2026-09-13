import { atomicToUsdc, AVALANCHE_FUJI_NETWORK, AVALANCHE_FUJI_USDC_ADDRESS } from "../x402/config.js";
import { X402Error } from "../x402/errors.js";
import { fetchX402Resource, type X402FetchResult } from "../x402/client.js";

const DEFAULT_BACKEND_URL = "https://v52-backend.onrender.com";
const WALLET_FLOW_PATH = "/v1/agent/investigations/wallet-flow";

export type Vector52AgentCapabilities = {
  channel: "AGENT_X402";
  ready: boolean;
  endpoint: string;
  payment_protocol: "x402";
  network: string;
  asset: string;
  amount_atomic: string;
  pay_to?: string;
  amount_display?: string;
  asset_decimals?: number;
  billing_model?: string;
  warnings: string[];
};

export type WalletFlowInput = {
  targetAddress: string;
  chainId?: 1;
  limit?: number;
  fromDate?: string;
  toDate?: string;
  maxPaymentUsdc?: string;
};

export function getVector52BackendUrl(env: NodeJS.ProcessEnv = process.env): URL {
  const raw = env.V52_BACKEND_URL?.trim() || DEFAULT_BACKEND_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new X402Error("V52_BACKEND_CONFIGURATION_INVALID", "V52_BACKEND_URL no es una URL válida.");
  }
  const isLocalDevelopment =
    process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(isLocalDevelopment && url.protocol === "http:")) {
    throw new X402Error(
      "V52_BACKEND_CONFIGURATION_INVALID",
      "V52_BACKEND_URL debe usar HTTPS (HTTP solo se permite para localhost en desarrollo).",
    );
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  return url;
}

async function readJson<T>(url: URL): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new X402Error("V52_BACKEND_UNREACHABLE", "No fue posible conectar con v52-backend.");
  }
  if (!response.ok) {
    throw new X402Error(
      "V52_BACKEND_HTTP_ERROR",
      `v52-backend respondió HTTP ${response.status}.`,
    );
  }
  return (await response.json()) as T;
}

function validateCapabilities(value: Vector52AgentCapabilities): Vector52AgentCapabilities {
  if (
    value.channel !== "AGENT_X402" ||
    value.payment_protocol !== "x402" ||
    value.network !== AVALANCHE_FUJI_NETWORK ||
    value.asset.toLowerCase() !== AVALANCHE_FUJI_USDC_ADDRESS.toLowerCase() ||
    !/^\d+$/.test(value.amount_atomic)
  ) {
    throw new X402Error(
      "V52_BACKEND_CAPABILITIES_INVALID",
      "v52-backend anunció capacidades incompatibles con USDC en Avalanche Fuji.",
    );
  }
  return value;
}

export async function getVector52BackendStatus() {
  const baseUrl = getVector52BackendUrl();
  try {
    const capabilities = validateCapabilities(
      await readJson<Vector52AgentCapabilities>(new URL("/v1/agent/capabilities", baseUrl)),
    );
    return {
      reachable: true,
      ready: capabilities.ready,
      baseUrl: baseUrl.toString().replace(/\/$/, ""),
      capabilities,
    };
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message : "Estado desconocido.";
    return {
      reachable: false,
      ready: false,
      baseUrl: baseUrl.toString().replace(/\/$/, ""),
      reason: safeMessage,
    };
  }
}

export async function investigateVector52WalletFlow(
  input: WalletFlowInput,
): Promise<X402FetchResult> {
  const baseUrl = getVector52BackendUrl();
  const capabilities = validateCapabilities(
    await readJson<Vector52AgentCapabilities>(new URL("/v1/agent/capabilities", baseUrl)),
  );
  if (!capabilities.ready) {
    throw new X402Error(
      "V52_BACKEND_NOT_READY",
      `El canal x402 del backend no está listo: ${capabilities.warnings.join(" ") || "sin detalle"}`,
    );
  }

  const advertisedPrice = atomicToUsdc(BigInt(capabilities.amount_atomic));
  const maxPaymentUsdc = input.maxPaymentUsdc ?? advertisedPrice;
  const endpoint = capabilities.endpoint || WALLET_FLOW_PATH;
  if (endpoint !== WALLET_FLOW_PATH) {
    throw new X402Error(
      "V52_BACKEND_CAPABILITIES_INVALID",
      "El backend anunció un endpoint de investigación no reconocido.",
    );
  }

  return fetchX402Resource({
    url: new URL(endpoint, baseUrl).toString(),
    method: "POST",
    maxPaymentUsdc,
    body: {
      target_address: input.targetAddress,
      chain_id: input.chainId ?? 1,
      limit: input.limit ?? 25,
      ...(input.fromDate ? { from_date: input.fromDate } : {}),
      ...(input.toDate ? { to_date: input.toDate } : {}),
    },
  });
}
