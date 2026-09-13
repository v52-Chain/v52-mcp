import { isAddress, type Address } from "viem";

import { loadX402Config, requireVector52ApiConfig } from "./config.js";
import { X402Error } from "./errors.js";
import { fetchX402Resource, type X402FetchResult } from "./client.js";

export type Vector52WalletFlowInput = {
  targetAddress: Address;
  chainId?: 1;
  limit?: number;
  fromDate?: string;
  toDate?: string;
  maxPaymentUsdc?: string;
};

function assertIsoDate(value: string | undefined, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new X402Error("VECTOR52_REQUEST_INVALID", `${name} debe tener formato YYYY-MM-DD.`);
  }
  return value;
}

function buildWalletFlowBody(input: Vector52WalletFlowInput) {
  if (!isAddress(input.targetAddress)) {
    throw new X402Error("VECTOR52_REQUEST_INVALID", "targetAddress debe ser una dirección EVM válida.");
  }
  const limit = input.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new X402Error("VECTOR52_REQUEST_INVALID", "limit debe estar entre 1 y 100.");
  }

  return {
    target_address: input.targetAddress,
    chain_id: input.chainId ?? 1,
    limit,
    ...(input.fromDate ? { from_date: assertIsoDate(input.fromDate, "fromDate") } : {}),
    ...(input.toDate ? { to_date: assertIsoDate(input.toDate, "toDate") } : {}),
  };
}

export async function fetchVector52WalletFlow(input: Vector52WalletFlowInput): Promise<X402FetchResult> {
  const config = loadX402Config();
  requireVector52ApiConfig(config);

  const url = new URL("/v1/agent/investigations/wallet-flow", config.vector52ApiUrl);
  return fetchX402Resource({
    url: url.toString(),
    maxPaymentUsdc: input.maxPaymentUsdc,
    method: "POST",
    body: buildWalletFlowBody(input),
  });
}
