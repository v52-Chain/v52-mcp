import "dotenv/config";

import { decodePaymentRequiredHeader } from "@x402/core/http";

import { fetchX402Resource } from "../x402/client.js";
import { atomicToUsdc, loadX402Config, requireX402ClientConfig } from "../x402/config.js";
import { toSafeError } from "../x402/errors.js";
import { assertAllowedResourceUrl, assertPaymentPolicy } from "../x402/payment-policy.js";
import { getAgentAccount, readWalletBalances } from "../x402/wallet.js";

function heading(text: string) {
  console.log(`\n${text}\n${"=".repeat(text.length)}`);
}

async function main() {
  heading("AVALANCHE x402 PAYMENT TEST");

  const config = loadX402Config();
  requireX402ClientConfig(config);
  const account = getAgentAccount(config);
  const url = process.env.X402_DEMO_URL ?? `http://localhost:${process.env.PORT ?? "8080"}/demo/x402/premium-report`;
  assertAllowedResourceUrl(url, config);

  console.log(`Network: Avalanche Fuji`);
  console.log(`x402: ${config.network}`);
  console.log(`Agent: ${account.address}`);
  console.log(`Requesting: ${url}`);

  const before = await readWalletBalances(config, account.address);
  console.log(`Balance before — AVAX: ${before.avax ?? "n/a"}, USDC: ${before.usdc ?? "n/a"}`);

  const preview = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (preview.status !== 402) {
    throw new Error(`Expected HTTP 402 from the demo endpoint; got HTTP ${preview.status}.`);
  }
  console.log("→ HTTP 402");

  const header = preview.headers.get("payment-required");
  if (!header) throw new Error("PAYMENT-REQUIRED header is missing.");
  const paymentRequired = decodePaymentRequiredHeader(header);
  const requirement = paymentRequired.accepts[0];
  const approval = assertPaymentPolicy(requirement, config);
  console.log(`Payment required: ${approval.amountUsdc} USDC`);
  console.log(`Policy: MAX = ${atomicToUsdc(config.maxPaymentAtomic)} USDC`);
  console.log("✓ Payment approved");
  console.log("Signing and settling through the configured facilitator...");

  const result = await fetchX402Resource({ url });
  console.log("→ HTTP 200");
  console.log("Resource unlocked:");
  console.log(JSON.stringify(result, null, 2));
  if (result.txHash) console.log(`Transaction: ${result.txHash}`);

  const after = await readWalletBalances(config, account.address);
  console.log(`Balance after — AVAX: ${after.avax ?? "n/a"}, USDC: ${after.usdc ?? "n/a"}`);
  heading("TEST PASSED");
}

main().catch(error => {
  heading("TEST FAILED");
  console.error(JSON.stringify(toSafeError(error), null, 2));
  process.exitCode = 1;
});
