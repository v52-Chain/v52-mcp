import { x402Client } from "@x402/core/client";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from "@x402/core/http";
import type { PaymentRequirements } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";

import { loadX402Config, requireX402ClientConfig } from "./config.js";
import { X402Error } from "./errors.js";
import {
  assertAllowedResourceUrl,
  assertPaymentPolicy,
  reserveSessionSpend,
  type PaymentApproval,
  type PaymentReservation,
} from "./payment-policy.js";
import { getAgentAccount } from "./wallet.js";

export type X402FetchResult = {
  success: true;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  txHash?: string;
  resource: string;
  data: unknown;
};

function logX402(enabled: boolean, message: string, data?: Record<string, unknown>) {
  if (enabled && data) {
    console.info(`[x402] ${message}`, data);
    return;
  }
  console.info(`[x402] ${message}`);
}

async function readResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

const safeFetch: typeof fetch = (input, init) =>
  fetch(input, {
    ...init,
    redirect: "error",
    signal: init?.signal ?? AbortSignal.timeout(30_000),
  });

/**
 * Fetches an x402 HTTP resource. A raw 402 is inspected first, then the official
 * x402 fetch wrapper signs and retries only after the local policy accepts it.
 */
export async function fetchX402Resource(input: {
  url: string;
  maxPaymentUsdc?: string;
}): Promise<X402FetchResult> {
  const config = loadX402Config();
  requireX402ClientConfig(config);
  const url = assertAllowedResourceUrl(input.url, config);

  logX402(config.debug, "Requesting resource", { url: url.toString() });
  const firstResponse = await safeFetch(url, { headers: { accept: "application/json" } });
  if (firstResponse.status === 200) {
    return {
      success: true,
      network: config.network,
      amount: "0",
      asset: config.usdcAddress,
      payTo: "",
      resource: url.toString(),
      data: await readResponse(firstResponse),
    };
  }
  if (firstResponse.status !== 402) {
    throw new X402Error(
      "X402_RESOURCE_HTTP_ERROR",
      `El recurso respondió HTTP ${firstResponse.status}, no HTTP 402/200.`,
    );
  }

  logX402(config.debug, "402 Payment Required detected");
  const paymentHeader = firstResponse.headers.get("payment-required");
  if (!paymentHeader) {
    throw new X402Error("PAYMENT_REJECTED_MALFORMED", "La respuesta HTTP 402 no incluye PAYMENT-REQUIRED.");
  }

  let paymentRequired;
  try {
    paymentRequired = decodePaymentRequiredHeader(paymentHeader);
  } catch {
    throw new X402Error("PAYMENT_REJECTED_MALFORMED", "PAYMENT-REQUIRED no tiene formato x402 válido.");
  }

  const requirement = paymentRequired.accepts.find(
    item =>
      item.scheme === "exact" &&
      item.network === config.network &&
      item.asset.toLowerCase() === config.usdcAddress.toLowerCase(),
  );
  if (!requirement) {
    throw new X402Error(
      "PAYMENT_REJECTED_POLICY",
      "El recurso no ofrece un requisito exact para USDC en Avalanche Fuji.",
    );
  }

  const approval = assertPaymentPolicy(requirement, config, input.maxPaymentUsdc);
  const reservation = reserveSessionSpend(approval.amountAtomic, config);
  let signed = false;

  try {
    const account = getAgentAccount(config);
    const client = x402Client.fromConfig({
      schemes: [{ network: config.network, client: new ExactEvmScheme(account) }],
      spendControls: {
        maxAmountPerPayment: false,
        allowedAssets: [
          {
            network: config.network,
            asset: config.usdcAddress,
            maxAmountPerPayment: config.maxPaymentAtomic.toString(),
          },
        ],
      },
      policies: [
        (_version, requirements) =>
          requirements.filter(candidate => {
            try {
              assertPaymentPolicy(candidate, config, input.maxPaymentUsdc);
              return true;
            } catch {
              return false;
            }
          }),
      ],
      paymentRequirementsSelector: (_version, requirements) => {
        const candidate = requirements.find(item => item.network === config.network);
        if (!candidate) {
          throw new X402Error("PAYMENT_REJECTED_POLICY", "No existe una opción de pago permitida.");
        }
        return candidate;
      },
    });

    client.onBeforePaymentCreation(async context => {
      assertPaymentPolicy(context.selectedRequirements as PaymentRequirements, config, input.maxPaymentUsdc);
      logX402(config.debug, "Policy approved", {
        network: context.selectedRequirements.network,
        amount: approval.amountUsdc,
        asset: approval.asset,
        recipient: approval.payTo,
      });
    });
    client.onAfterPaymentCreation(async () => {
      signed = true;
      // A signed EIP-3009 authorization can be settled after the HTTP request, so
      // preserve this budget reservation even if a later transport error occurs.
      reservation.commit();
      logX402(config.debug, "Signing payment authorization");
    });

    const paidFetch = wrapFetchWithPayment(safeFetch, client);
    logX402(config.debug, "Sending payment proof");
    const paidResponse = await paidFetch(url, { headers: { accept: "application/json" } });

    if (!paidResponse.ok) {
      throw new X402Error(
        "X402_PAYMENT_NOT_SETTLED",
        `El recurso respondió HTTP ${paidResponse.status} después de enviar la prueba de pago.`,
      );
    }

    let txHash: string | undefined;
    const settlementHeader = paidResponse.headers.get("payment-response");
    if (settlementHeader) {
      try {
        const settlement = decodePaymentResponseHeader(settlementHeader);
        if (settlement.success && settlement.transaction) {
          txHash = settlement.transaction;
        }
      } catch {
        // The resource succeeded; a malformed optional settlement header must not invent a hash.
      }
    }

    logX402(config.debug, "Resource unlocked", { transaction: txHash });
    return {
      success: true,
      network: config.network,
      amount: approval.amountUsdc,
      asset: approval.asset,
      payTo: approval.payTo,
      txHash,
      resource: url.toString(),
      data: await readResponse(paidResponse),
    };
  } catch (error) {
    if (!signed) reservation.release();
    throw error;
  }
}
