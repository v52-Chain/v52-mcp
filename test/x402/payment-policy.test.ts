import assert from "node:assert/strict";
import test from "node:test";

import { getAddress } from "viem";

import { AVALANCHE_FUJI_NETWORK, getX402ConfigurationStatus, type X402Config } from "../../src/x402/config.js";
import { X402Error } from "../../src/x402/errors.js";
import {
  assertAllowedResourceUrl,
  assertPaymentPolicy,
  resetSessionSpendForTests,
  reserveSessionSpend,
} from "../../src/x402/payment-policy.js";

const USDC = getAddress("0x5425890298aed601595a70AB815c96711a31Bc65");
const PAY_TO = getAddress("0x1111111111111111111111111111111111111111");

const config: X402Config = {
  rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc",
  network: AVALANCHE_FUJI_NETWORK,
  chainId: 43113,
  usdcAddress: USDC,
  facilitatorUrl: "https://facilitator.payai.network",
  merchantAddress: PAY_TO,
  agentPrivateKey: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  maxPaymentAtomic: 50_000n,
  maxSessionSpendAtomic: 100_000n,
  allowedHosts: ["api.example.test"],
  allowLocalhost: false,
  debug: false,
};

function requirement(overrides: Record<string, unknown> = {}) {
  return {
    scheme: "exact",
    network: AVALANCHE_FUJI_NETWORK,
    asset: USDC,
    amount: "10000",
    payTo: PAY_TO,
    maxTimeoutSeconds: 60,
    extra: { name: "USD Coin", version: "2" },
    ...overrides,
  };
}

function expectCode(fn: () => unknown, code: string) {
  assert.throws(fn, (error: unknown) => error instanceof X402Error && error.code === code);
}

test("0.01 USDC Fuji exact payment is accepted", () => {
  const approval = assertPaymentPolicy(requirement(), config);
  assert.equal(approval.amountUsdc, "0.01");
});

test("payment above 0.05 USDC is rejected", () => {
  expectCode(() => assertPaymentPolicy(requirement({ amount: "1000000" }), config), "PAYMENT_REJECTED_MAX_LIMIT");
});

test("Avalanche mainnet is rejected", () => {
  expectCode(() => assertPaymentPolicy(requirement({ network: "eip155:43114" }), config), "PAYMENT_REJECTED_NETWORK");
});

test("unknown token is rejected", () => {
  expectCode(
    () => assertPaymentPolicy(requirement({ asset: "0x2222222222222222222222222222222222222222" }), config),
    "PAYMENT_REJECTED_ASSET",
  );
});

test("malformed payment requirements are rejected", () => {
  expectCode(() => assertPaymentPolicy(requirement({ amount: "0.01", extra: undefined }), config), "PAYMENT_REJECTED_MALFORMED");
});

test("unapproved and SSRF URLs are rejected", () => {
  expectCode(() => assertAllowedResourceUrl("file:///etc/passwd", config), "URL_REJECTED");
  expectCode(() => assertAllowedResourceUrl("http://127.0.0.1:8080", config), "URL_REJECTED");
  expectCode(() => assertAllowedResourceUrl("https://untrusted.example", config), "URL_REJECTED");
});

test("a private key is never included in serializable status", () => {
  const key = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const status = getX402ConfigurationStatus({
    X402_AGENT_PRIVATE_KEY: key,
    X402_USDC_ADDRESS: USDC,
    X402_FACILITATOR_URL: "https://facilitator.payai.network",
    X402_MERCHANT_ADDRESS: PAY_TO,
  });
  assert.equal(JSON.stringify(status).includes(key), false);
});

test("the process-local session limit is enforced", () => {
  resetSessionSpendForTests();
  const first = reserveSessionSpend(50_000n, config);
  first.commit();
  const second = reserveSessionSpend(50_000n, config);
  second.commit();
  expectCode(() => reserveSessionSpend(1n, config), "PAYMENT_REJECTED_SESSION_LIMIT");
  resetSessionSpendForTests();
});
